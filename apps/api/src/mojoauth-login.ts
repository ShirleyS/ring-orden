import {
  HttpError,
  makeSessionCookie,
  validateMutationOrigin,
  verifyMojoToken,
} from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";

const callbackPath = "/api/auth/mojo/callback";
const transactionName = "__Host-ring_mojo_tx";
const cookieAttributes = "; HttpOnly; Secure; SameSite=Lax; Path=/";
const clearTransaction = `${transactionName}=${cookieAttributes}; Max-Age=0`;
const clearWorkspace = `ring_workspace=${cookieAttributes}; Max-Age=0`;
const encoder = new TextEncoder();
const encode = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
const decode = (text: string) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const random = () => encode(crypto.getRandomValues(new Uint8Array(32)));
const securityHeaders = {
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};
interface Transaction {
  state: string;
  nonce: string;
  verifier: string;
  expires: number;
  issuer: string;
  client: string;
  callback: string;
}
interface Discovery {
  authorization: string;
  token: string;
  authMethod: "client_secret_post" | "client_secret_basic";
}

function configuration(env: RuntimeEnv) {
  const {
    MOJOAUTH_ISSUER: issuer,
    MOJOAUTH_AUDIENCE: client,
    MOJOAUTH_CLIENT_SECRET: secret,
    MOJOAUTH_JWKS_URL: jwks,
  } = env;
  if (
    !issuer ||
    !client ||
    !secret ||
    !jwks ||
    !env.SESSION_SECRET ||
    env.SESSION_SECRET.length < 32
  )
    throw new HttpError(503, "MojoAuth hosted sign-in is not configured.");
  try {
    const url = new URL(issuer);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error();
    const keys = new URL(jwks);
    if (
      keys.origin !== url.origin ||
      keys.username ||
      keys.password ||
      keys.hash ||
      keys.protocol !== "https:"
    )
      throw new Error();
  } catch {
    throw new HttpError(503, "MojoAuth hosted sign-in is not configured.");
  }
  return { issuer, client, secret, jwks };
}
function configured(env: RuntimeEnv) {
  try {
    configuration(env);
    return true;
  } catch {
    return false;
  }
}
async function discovery(env: RuntimeEnv): Promise<Discovery> {
  const config = configuration(env);
  const response = await fetch(
    config.issuer.replace(/\/$/, "") + "/.well-known/openid-configuration",
    {
      redirect: "error",
      signal: AbortSignal.timeout(7000),
      headers: { Accept: "application/json" },
    },
  );
  if (!response.ok) throw new Error("Discovery unavailable");
  const data = (await response.json()) as Record<string, unknown>;
  if (
    data.issuer !== config.issuer ||
    data.jwks_uri !== config.jwks ||
    !Array.isArray(data.code_challenge_methods_supported) ||
    !data.code_challenge_methods_supported.includes("S256") ||
    !Array.isArray(data.id_token_signing_alg_values_supported) ||
    !data.id_token_signing_alg_values_supported.includes("RS256") ||
    !Array.isArray(data.response_types_supported) ||
    !data.response_types_supported.includes("code")
  )
    throw new Error("Invalid discovery");
  const endpoint = (value: unknown) => {
    if (typeof value !== "string") throw new Error("Missing endpoint");
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      url.origin !== new URL(config.issuer).origin ||
      url.username ||
      url.password ||
      url.hash
    )
      throw new Error("Invalid endpoint");
    return url.href;
  };
  const methods = data.token_endpoint_auth_methods_supported;
  const authMethod =
    Array.isArray(methods) && methods.includes("client_secret_post")
      ? "client_secret_post"
      : methods === undefined ||
          (Array.isArray(methods) && methods.includes("client_secret_basic"))
        ? "client_secret_basic"
        : null;
  if (!authMethod) throw new Error("Unsupported client authentication");
  return {
    authorization: endpoint(data.authorization_endpoint),
    token: endpoint(data.token_endpoint),
    authMethod,
  };
}
async function transactionKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      encoder.encode("ring-mojo-transaction:" + secret),
    ),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
}
async function seal(transaction: Transaction, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await transactionKey(secret),
    encoder.encode(JSON.stringify(transaction)),
  );
  return encode(iv) + "." + encode(new Uint8Array(data));
}
async function unseal(value: string, secret: string): Promise<Transaction> {
  if (!value || value.length > 4096) throw new Error("Invalid transaction");
  const parts = value.split(".");
  if (parts.length !== 2) throw new Error("Invalid transaction");
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(parts[0]) },
    await transactionKey(secret),
    decode(parts[1]),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as Transaction;
}
function redirect(location: string, cookies: string[]) {
  const headers = new Headers({ ...securityHeaders, Location: location });
  for (const cookie of cookies) headers.append("Set-Cookie", cookie);
  return new Response(null, { status: 302, headers });
}
function json(body: unknown, status = 200, extra?: HeadersInit) {
  return Response.json(body, {
    status,
    headers: { ...securityHeaders, ...extra },
  });
}
function errorResponse(error: unknown) {
  return json(
    {
      error:
        error instanceof HttpError
          ? error.message
          : "MojoAuth sign-in is temporarily unavailable. Please try again.",
    },
    error instanceof HttpError ? error.status : 503,
  );
}

/** Authentication routes intentionally precede repository initialization. */
export async function handleMojoAuthRequest(
  request: Request,
  env: RuntimeEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (
    ![
      "/api/auth/config",
      "/api/auth/mojo/login",
      callbackPath,
      "/api/auth/logout",
    ].includes(path)
  )
    return null;
  const allowedMethod = path === "/api/auth/logout" ? "POST" : "GET";
  if (request.method !== allowedMethod)
    return json({ error: "Method not allowed." }, 405, {
      Allow: allowedMethod,
    });
  if (path === "/api/auth/config")
    return json({
      mojoauth: {
        configured: configured(env),
        login_path: "/api/auth/mojo/login",
      },
    });
  if (path === "/api/auth/logout") {
    try {
      validateMutationOrigin(request);
    } catch (error) {
      return errorResponse(error);
    }
    const headers = new Headers(securityHeaders);
    for (const cookie of [
      `ring_session=${cookieAttributes}; Max-Age=0`,
      clearWorkspace,
      clearTransaction,
    ])
      headers.append("Set-Cookie", cookie);
    return Response.json({ ok: true }, { headers });
  }
  if (path === "/api/auth/mojo/login") {
    try {
      const config = configuration(env);
      const provider = await discovery(env);
      const tx: Transaction = {
        state: random(),
        nonce: random(),
        verifier: random(),
        expires: Date.now() + 600000,
        issuer: config.issuer,
        client: config.client,
        callback: url.origin + callbackPath,
      };
      const authorization = new URL(provider.authorization);
      for (const [key, value] of Object.entries({
        response_type: "code",
        client_id: config.client,
        redirect_uri: tx.callback,
        scope: "openid profile email",
        state: tx.state,
        nonce: tx.nonce,
        code_challenge_method: "S256",
        code_challenge: encode(
          new Uint8Array(
            await crypto.subtle.digest("SHA-256", encoder.encode(tx.verifier)),
          ),
        ),
      }))
        authorization.searchParams.set(key, value);
      return redirect(authorization.href, [
        `${transactionName}=${await seal(tx, env.SESSION_SECRET!)}${cookieAttributes}; Max-Age=600`,
      ]);
    } catch (error) {
      return errorResponse(error);
    }
  }
  try {
    const config = configuration(env);
    const cookie =
      request.headers
        .get("cookie")
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(transactionName + "="))
        ?.slice(transactionName.length + 1) ?? "";
    const tx = await unseal(cookie, env.SESSION_SECRET!);
    if (
      typeof tx.expires !== "number" ||
      tx.expires <= Date.now() ||
      tx.expires > Date.now() + 600000 ||
      typeof tx.state !== "string" ||
      tx.state !== url.searchParams.get("state") ||
      typeof tx.nonce !== "string" ||
      !tx.nonce ||
      typeof tx.verifier !== "string" ||
      !tx.verifier ||
      tx.issuer !== config.issuer ||
      tx.client !== config.client ||
      tx.callback !== url.origin + callbackPath
    )
      throw new Error("Invalid transaction");
    if (url.searchParams.has("error"))
      return redirect("/?signin_error=cancelled", [clearTransaction]);
    const code = url.searchParams.get("code");
    if (!code || code.length > 4096) throw new Error("Missing code");
    const provider = await discovery(env);
    const form = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: tx.callback,
      client_id: config.client,
      code_verifier: tx.verifier,
    });
    const headers: Record<string, string> = {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    };
    if (provider.authMethod === "client_secret_post")
      form.set("client_secret", config.secret);
    else
      headers.Authorization =
        "Basic " +
        btoa(
          encodeURIComponent(config.client) +
            ":" +
            encodeURIComponent(config.secret),
        );
    const response = await fetch(provider.token, {
      method: "POST",
      headers,
      body: form.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error("Code exchange failed");
    const tokens = (await response.json()) as Record<string, unknown>;
    if (typeof tokens.id_token !== "string")
      throw new Error("Missing ID token");
    const identity = await verifyMojoToken(tokens.id_token, env, tx.nonce);
    return redirect("/", [
      clearTransaction,
      clearWorkspace,
      await makeSessionCookie(identity, env),
    ]);
  } catch {
    return redirect("/?signin_error=failed", [clearTransaction]);
  }
}
