import test from "node:test";
import assert from "node:assert/strict";
import * as auth from "../src/auth.ts";
import { handleRequest } from "../src/server.ts";
const mojo: auth.Identity = {
  id: "mojo:abc",
  email: "Owner@Example.com",
  name: "Owner",
  provider: "mojoauth",
  email_verified: true,
};
const env = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SERVER_SECRET: "sb_secret_server",
};

test("public MojoAuth configuration works before database setup and excludes secrets", async () => {
  const response = await handleRequest(
    new Request("https://ring.test/api/auth/config"),
    {
      MOJOAUTH_ISSUER: "https://tenant.auth.mojoauth.com",
      MOJOAUTH_AUDIENCE: "client-id",
      MOJOAUTH_JWKS_URL:
        "https://tenant.auth.mojoauth.com/.well-known/jwks.json",
      SESSION_SECRET: "must-not-be-exposed",
      SUPABASE_URL: "invalid",
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    provider: "mojoauth",
    issuer: "https://tenant.auth.mojoauth.com",
    clientId: "client-id",
  });
});

test("verified MojoAuth email preserves an existing Supabase workspace subject", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({
        users: [
          {
            id: "existing-owner",
            email: "owner@example.com",
            email_confirmed_at: "2026-10-28T00:00:00Z",
          },
        ],
      });
    assert.equal(typeof (auth as any).linkMojoIdentity, "function");
    const linked = await (auth as any).linkMojoIdentity(mojo, env);
    assert.equal(linked.id, "supabase:existing-owner");
    assert.equal(linked.provider, "mojoauth");
  } finally {
    globalThis.fetch = original;
  }
});

test("unverified MojoAuth email cannot claim a workspace", async () => {
  assert.equal(typeof (auth as any).linkMojoIdentity, "function");
  await assert.rejects(
    (auth as any).linkMojoIdentity({ ...mojo, email_verified: false }, env),
    /verified email/i,
  );
});

test("account lookup failure blocks login instead of creating an empty workspace", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("unavailable", { status: 503 });
    assert.equal(typeof (auth as any).linkMojoIdentity, "function");
    await assert.rejects(
      (auth as any).linkMojoIdentity(mojo, env),
      /account|workspace/i,
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("only a confirmed matching account is linked and pagination is followed", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () =>
      Response.json(
        ++calls === 1
          ? {
              users: Array.from({ length: 1000 }, () => ({
                id: "other",
                email: "other@example.com",
              })),
            }
          : { users: [{ id: "unconfirmed", email: "owner@example.com" }] },
      );
    assert.equal(typeof (auth as any).linkMojoIdentity, "function");
    const linked = await (auth as any).linkMojoIdentity(mojo, env);
    assert.equal(linked.id, mojo.id);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = original;
  }
});

test("a signed MojoAuth login issues a secure cookie for the existing account; tampering is rejected", async () => {
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
    kid: "test-key",
  };
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const content =
    encode({ alg: "RS256", kid: "test-key" }) +
    "." +
    encode({
      iss: "https://tenant.auth.mojoauth.com",
      aud: "client-id",
      sub: "abc",
      email: "owner@example.com",
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 600,
    });
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(content),
  );
  const token = content + "." + Buffer.from(signature).toString("base64url");
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input) =>
      String(input).includes("jwks")
        ? Response.json({ keys: [jwk] })
        : Response.json({
            users: [
              {
                id: "existing-owner",
                email: "owner@example.com",
                email_confirmed_at: "2026-10-28T00:00:00Z",
              },
            ],
          });
    const configuration = {
      ...env,
      MOJOAUTH_ISSUER: "https://tenant.auth.mojoauth.com",
      MOJOAUTH_AUDIENCE: "client-id",
      MOJOAUTH_JWKS_URL: "https://tenant.auth.mojoauth.com/jwks",
      SESSION_SECRET: "a-session-secret-with-at-least-32-characters",
    };
    const signIn = (value: string) =>
      handleRequest(
        new Request("https://ring.test/api/auth/session", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://ring.test",
          },
          body: JSON.stringify({ access_token: value }),
        }),
        configuration,
      );
    const response = await signIn(token);
    assert.equal(response.status, 200);
    const cookie = response.headers.get("set-cookie")!;
    assert.match(cookie, /HttpOnly; Secure; SameSite=Lax/);
    const identity = await auth.identityFromRequest(
      new Request("https://ring.test/api/bootstrap", {
        headers: { Cookie: cookie.split(";")[0] },
      }),
      configuration,
    );
    assert.equal(identity.id, "supabase:existing-owner");
    assert.equal(
      (await signIn(content + "." + Buffer.alloc(256).toString("base64url")))
        .status,
      401,
    );
  } finally {
    globalThis.fetch = original;
  }
});
