import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import { identityFromRequest } from "../src/auth.ts";

const origin = "https://merchant.test";
const issuer = "https://ring.auth.mojoauth.com";
const env = {
  MOJOAUTH_ISSUER: issuer,
  MOJOAUTH_JWKS_URL: issuer + "/.well-known/jwks.json",
  MOJOAUTH_AUDIENCE: "client-ring",
  MOJOAUTH_CLIENT_SECRET: "server-only-client-secret",
  SESSION_SECRET:
    "a-test-session-secret-at-least-64-characters-long-and-only-for-tests",
};
const pair = await crypto.subtle.generateKey(
  {
    name: "RSASSA-PKCS1-v1_5",
    modulusLength: 2048,
    publicExponent: new Uint8Array([1, 0, 1]),
    hash: "SHA-256",
  },
  true,
  ["sign", "verify"],
);
const jwk = {
  ...(await crypto.subtle.exportKey("jwk", pair.publicKey)),
  kid: "ring-key",
  alg: "RS256",
  use: "sig",
};
const encode = (value: unknown) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");
async function token(claims: Record<string, unknown>) {
  const payload =
    encode({ alg: "RS256", kid: "ring-key" }) + "." + encode(claims);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(payload),
  );
  return payload + "." + Buffer.from(signature).toString("base64url");
}
const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");

async function fixture(
  run: (f: {
    begin: () => Promise<{ response: Response; auth: URL; cookie: string }>;
    callback: (
      auth: URL,
      cookie: string,
      extra?: Record<string, string>,
    ) => Promise<Response>;
    discovery: Record<string, unknown>;
    claims: Record<string, unknown>;
    calls: string[];
    tokenReply: {
      status?: number;
      omitIdToken?: boolean;
      alterSignature?: boolean;
    };
  }) => Promise<void>,
) {
  const originalFetch = globalThis.fetch;
  const discovery: Record<string, unknown> = {
    issuer,
    authorization_endpoint: issuer + "/oauth/authorize",
    token_endpoint: issuer + "/oauth2/token",
    jwks_uri: env.MOJOAUTH_JWKS_URL,
    response_types_supported: ["code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "client_secret_post",
      "client_secret_basic",
    ],
    id_token_signing_alg_values_supported: ["RS256"],
  };
  const claims: Record<string, unknown> = {};
  const calls: string[] = [];
  const tokenReply: {
    status?: number;
    omitIdToken?: boolean;
    alterSignature?: boolean;
  } = {};
  let nonce = "";
  let verifierChallenge = "";
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(
      init?.redirect,
      "error",
      "credentials and keys must not follow redirects",
    );
    if (url === issuer + "/.well-known/openid-configuration")
      return Response.json(discovery);
    if (url === env.MOJOAUTH_JWKS_URL) return Response.json({ keys: [jwk] });
    if (url === issuer + "/oauth2/token") {
      assert.equal(init?.method, "POST");
      const form = new URLSearchParams(String(init?.body));
      assert.equal(form.get("grant_type"), "authorization_code");
      assert.equal(form.get("client_id"), "client-ring");
      if (
        (discovery.token_endpoint_auth_methods_supported as string[]).includes(
          "client_secret_post",
        )
      ) {
        assert.equal(form.get("client_secret"), "server-only-client-secret");
      } else {
        assert.equal(form.has("client_secret"), false);
        assert.equal(
          new Headers(init?.headers).get("Authorization"),
          "Basic " + btoa("client-ring:server-only-client-secret"),
        );
      }
      assert.equal(
        form.get("redirect_uri"),
        origin + "/api/auth/mojo/callback",
      );
      assert.equal(form.get("code"), "authorization-code");
      assert.equal(
        Buffer.from(
          await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(form.get("code_verifier")!),
          ),
        ).toString("base64url"),
        verifierChallenge,
      );
      const now = Math.floor(Date.now() / 1000);
      let idToken = await token({
        iss: issuer,
        aud: "client-ring",
        sub: "owner-123",
        email: "owner@example.com",
        email_verified: true,
        name: "Owner",
        iat: now,
        exp: now + 3600,
        nonce,
        ...claims,
      });
      if (tokenReply.alterSignature) {
        const parts = idToken.split(".");
        parts[2] = (parts[2][0] === "a" ? "b" : "a") + parts[2].slice(1);
        idToken = parts.join(".");
      }
      return Response.json(
        {
          access_token: "opaque-api-token-not-an-id-token",
          token_type: "Bearer",
          expires_in: 3600,
          ...(tokenReply.omitIdToken ? {} : { id_token: idToken }),
          error_description: "private-provider-diagnostic",
        },
        { status: tokenReply.status ?? 200 },
      );
    }
    throw new Error("Unexpected outbound URL: " + url);
  };
  try {
    await run({
      discovery,
      claims,
      calls,
      tokenReply,
      begin: async () => {
        // No repository: public authentication must not need storage to start.
        const response = await handleRequest(
          new Request(origin + "/api/auth/mojo/login"),
          env,
        );
        assert.equal(response.status, 302, await response.clone().text());
        const auth = new URL(response.headers.get("location")!);
        nonce = auth.searchParams.get("nonce")!;
        verifierChallenge = auth.searchParams.get("code_challenge")!;
        return { response, auth, cookie: cookieHeader(response) };
      },
      callback: (auth, cookie, extra = {}) => {
        const params = new URLSearchParams({
          code: "authorization-code",
          state: auth.searchParams.get("state")!,
          ...extra,
        });
        return handleRequest(
          new Request(origin + "/api/auth/mojo/callback?" + params, {
            headers: { cookie },
          }),
          env,
        );
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("hosted login sets PKCE, state and nonce in an encrypted browser transaction", async () => {
  await fixture(async ({ begin }) => {
    const { response, auth, cookie } = await begin();
    assert.equal(auth.origin, issuer);
    assert.equal(auth.pathname, "/oauth/authorize");
    assert.equal(auth.searchParams.get("response_type"), "code");
    assert.equal(auth.searchParams.get("client_id"), "client-ring");
    assert.equal(auth.searchParams.get("scope"), "openid profile email");
    assert.equal(
      auth.searchParams.get("redirect_uri"),
      origin + "/api/auth/mojo/callback",
    );
    assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
    for (const key of ["nonce", "state", "code_challenge"])
      assert.ok(auth.searchParams.get(key)!.length >= 43);
    assert.ok(!cookie.includes(auth.searchParams.get("nonce")!));
    const header = response.headers.get("set-cookie")!;
    for (const attr of ["HttpOnly", "Secure", "SameSite=Lax", "Max-Age=600"])
      assert.ok(header.includes(attr));
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.ok(!auth.href.includes(env.MOJOAUTH_CLIENT_SECRET));
  });
});

test("valid hosted callback creates a session that opens the correct isolated workspace", async () => {
  await fixture(async ({ begin, callback }) => {
    const { auth, cookie } = await begin();
    const response = await callback(auth, cookie);
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/");
    assert.ok(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith("ring_session=") && c.includes("HttpOnly")),
    );
    assert.ok(
      response.headers.getSetCookie().some((c) => c.includes("Max-Age=0")),
    );
    const session = cookieHeader(response);
    const user = await identityFromRequest(
      new Request(origin, { headers: { cookie: session } }),
      { ...env, SUPABASE_URL: "https://database.supabase.co" },
    );
    assert.equal(user.id, "mojo:owner-123");
    assert.equal(user.email_verified, true);
    const bootstrap = await handleRequest(
      new Request(origin + "/api/bootstrap", { headers: { cookie: session } }),
      env,
      new MemoryRepository(),
    );
    assert.equal(bootstrap.status, 200);
    const data = (await bootstrap.json()) as any;
    assert.equal(data.user.provider, "mojoauth");
    assert.ok(!session.includes("opaque-api-token"));
  });
});

test("auth readiness reveals no credentials and does not require a database", async () => {
  const ready = await handleRequest(
    new Request(origin + "/api/auth/config"),
    env,
  );
  assert.equal(ready.status, 200);
  assert.deepEqual(await ready.json(), {
    mojoauth: { configured: true, login_path: "/api/auth/mojo/login" },
  });
  const notReady = await handleRequest(
    new Request(origin + "/api/auth/config"),
    { ...env, MOJOAUTH_CLIENT_SECRET: "" },
  );
  assert.equal(((await notReady.json()) as any).mojoauth.configured, false);
});

test("client-secret-basic discovery authenticates the code exchange server-side", async () => {
  await fixture(async ({ begin, callback, discovery }) => {
    discovery.token_endpoint_auth_methods_supported = ["client_secret_basic"];
    const { auth, cookie } = await begin();
    const response = await callback(auth, cookie);
    assert.equal(response.headers.get("location"), "/");
    assert.ok(
      response.headers
        .getSetCookie()
        .some((c) => c.startsWith("ring_session=")),
    );
  });
});

for (const invalid of [
  { status: 401 },
  { omitIdToken: true },
  { alterSignature: true },
]) {
  test(`provider ${Object.keys(invalid)[0]} does not create a session or leak provider details`, async () => {
    await fixture(async ({ begin, callback, tokenReply }) => {
      const { auth, cookie } = await begin();
      Object.assign(tokenReply, invalid);
      const response = await callback(auth, cookie);
      assert.equal(response.headers.get("location"), "/?signin_error=failed");
      assert.ok(
        !response.headers
          .getSetCookie()
          .some((c) => c.startsWith("ring_session=")),
      );
      assert.equal(await response.text(), "");
    });
  });
}

test("same email through another provider does not grant an existing merchant workspace", async () => {
  await fixture(async ({ begin, callback }) => {
    const repo = new MemoryRepository();
    const previous = await handleRequest(
      new Request(origin + "/api/bootstrap", {
        headers: {
          "oai-authenticated-user-id": "previous-provider-owner",
          "oai-authenticated-user-email": "owner@example.com",
        },
      }),
      { TRUST_SITES_HEADERS: "true" },
      repo,
    );
    const previousData = (await previous.json()) as any;
    const { auth, cookie } = await begin();
    const login = await callback(auth, cookie);
    const response = await handleRequest(
      new Request(origin + "/api/bootstrap", {
        headers: { cookie: cookieHeader(login) },
      }),
      env,
      repo,
    );
    const current = (await response.json()) as any;
    assert.equal(response.status, 200);
    assert.equal(current.user.email, previousData.user.email);
    assert.notEqual(current.merchant.id, previousData.merchant.id);
  });
});

test("missing server secret cannot start a hosted login", async () => {
  const response = await handleRequest(
    new Request(origin + "/api/auth/mojo/login"),
    { ...env, MOJOAUTH_CLIENT_SECRET: "" },
  );
  assert.equal(response.status, 503);
  assert.equal(response.headers.has("set-cookie"), false);
});

for (const kind of [
  "missing cookie",
  "wrong state",
  "tampered cookie",
  "expired cookie",
  "changed client",
  "changed origin",
] as const) {
  test(`${kind} callback cannot exchange a code or create a session`, async () => {
    await fixture(async ({ begin, callback, calls }) => {
      const { auth, cookie } = await begin();
      const originalNow = Date.now;
      try {
        if (kind === "expired cookie") Date.now = () => originalNow() + 601000;
        let response: Response;
        if (kind === "changed client" || kind === "changed origin") {
          const url = new URL(origin + "/api/auth/mojo/callback");
          url.searchParams.set("code", "authorization-code");
          url.searchParams.set("state", auth.searchParams.get("state")!);
          if (kind === "changed origin") url.hostname = "another-merchant.test";
          response = await handleRequest(
            new Request(url, { headers: { cookie } }),
            {
              ...env,
              ...(kind === "changed client"
                ? { MOJOAUTH_AUDIENCE: "different-client" }
                : {}),
            },
          );
        } else
          response = await callback(
            auth,
            kind === "missing cookie"
              ? ""
              : kind === "tampered cookie"
                ? cookie + "x"
                : cookie,
            kind === "wrong state" ? { state: "attacker-state" } : {},
          );
        assert.equal(response.status, 302);
        assert.ok(
          response.headers.get("location")!.startsWith("/?signin_error="),
        );
        assert.ok(
          !response.headers
            .getSetCookie()
            .some((c) => c.startsWith("ring_session=")),
        );
        assert.ok(!calls.includes(issuer + "/oauth2/token"));
      } finally {
        Date.now = originalNow;
      }
    });
  });
}

for (const invalid of [
  { nonce: "wrong-nonce" },
  { aud: "other-client" },
  { iss: "https://imposter.test" },
  { exp: 1 },
  { sub: "" },
  { iat: 9999999999 },
  { aud: ["client-ring", "other"], azp: "other" },
]) {
  test(`signed ID token with invalid ${Object.keys(invalid).join("/")} cannot create a session`, async () => {
    await fixture(async ({ begin, callback, claims }) => {
      const { auth, cookie } = await begin();
      Object.assign(claims, invalid);
      const response = await callback(auth, cookie);
      assert.equal(response.status, 302);
      assert.ok(
        response.headers.get("location")!.startsWith("/?signin_error="),
      );
      assert.ok(
        !response.headers
          .getSetCookie()
          .some((c) => c.startsWith("ring_session=")),
      );
    });
  });
}

for (const field of [
  "issuer",
  "token_endpoint",
  "authorization_endpoint",
  "jwks_uri",
]) {
  test(`untrusted discovery ${field} is rejected before redirecting or transmitting credentials`, async () => {
    await fixture(async ({ discovery, calls }) => {
      discovery[field] = "https://attacker.test/collect";
      const response = await handleRequest(
        new Request(origin + "/api/auth/mojo/login"),
        env,
      );
      assert.equal(response.status, 503);
      assert.equal(response.headers.has("location"), false);
      assert.ok(calls.every((url) => url.startsWith(issuer + "/")));
    });
  });
}

test("provider cancellation returns a safe error and clears the transaction", async () => {
  await fixture(async ({ begin, callback, calls }) => {
    const { auth, cookie } = await begin();
    const response = await callback(auth, cookie, {
      error: "access_denied",
      error_description: "sensitive-provider-detail",
    });
    assert.equal(response.status, 302);
    assert.equal(response.headers.get("location"), "/?signin_error=cancelled");
    assert.ok(
      response.headers.getSetCookie().some((c) => c.includes("Max-Age=0")),
    );
    assert.ok(!calls.includes(issuer + "/oauth2/token"));
  });
});

test("logout is same-origin POST and clears the session without needing storage", async () => {
  const get = await handleRequest(
    new Request(origin + "/api/auth/logout"),
    env,
  );
  assert.equal(get.status, 405);
  const cross = await handleRequest(
    new Request(origin + "/api/auth/logout", {
      method: "POST",
      headers: { origin: "https://attacker.test" },
    }),
    env,
  );
  assert.equal(cross.status, 403);
  const response = await handleRequest(
    new Request(origin + "/api/auth/logout", {
      method: "POST",
      headers: { origin },
    }),
    env,
  );
  assert.equal(response.status, 200);
  assert.ok(
    response.headers
      .getSetCookie()
      .some((c) => c.startsWith("ring_session=;") && c.includes("Max-Age=0")),
  );
});
