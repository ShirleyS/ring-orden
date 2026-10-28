export interface RuntimeEnv {
  DB?: D1Database;
  MOJOAUTH_JWKS_URL?: string;
  MOJOAUTH_ISSUER?: string;
  MOJOAUTH_AUDIENCE?: string;
  SESSION_SECRET?: string;
  DEMO_MODE?: string;
  TRUST_SITES_HEADERS?: string;
  FIRECRAWL_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  TWILIO_ACCOUNT_SID?: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_WHATSAPP_FROM?: string;
  TWILIO_WHATSAPP_TEMPLATE_SID?: string;
  ELEVENLABS_API_KEY?: string;
  ELEVENLABS_AGENT_ID?: string;
  ELEVENLABS_AGENT_PUBLIC?: string;
  AGENT_TOOL_SECRET?: string;
  AGENT_MERCHANT_ID?: string;
  SQUARE_ACCESS_TOKEN?: string;
  SQUARE_LOCATION_ID?: string;
  SQUARE_ENVIRONMENT?: string;
  N8N_WEBHOOK_URL?: string;
  N8N_WEBHOOK_SECRET?: string;
  APP_ORIGIN?: string;
  CUSTOMER_APP_ORIGIN?: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_SERVER_SECRET?: string;
  SUPABASE_MIGRATE_D1?: string;
  [key: string]: unknown;
}
export interface Identity {
  id: string;
  email: string;
  name: string;
  provider: "sites" | "mojoauth" | "supabase" | "local-demo";
  email_verified?: boolean;
}
/** Normalize configuration copied from an Authorization header, never incoming requests. */
export function configuredAgentSecret(env: RuntimeEnv): string | undefined {
  let value = env.AGENT_TOOL_SECRET?.trim();
  if (!value) return undefined;
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    value = value.slice(1, -1).trim();
  value = value.replace(/^Bearer[ \t]+/i, "").trim();
  if (
    !value ||
    /^Bearer(?:\s|$)/i.test(value) ||
    /[\r\n]/.test(value) ||
    /^["']|["']$/.test(value)
  )
    return undefined;
  return value;
}
export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}
const encoder = new TextEncoder();
const bytes = (value: string) =>
  Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
const b64 = (data: Uint8Array) =>
  btoa(String.fromCharCode(...data))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
export async function tenantIdFor(ownerId: string): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(ownerId));
  return (
    "merchant_" +
    Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 24)
  );
}
export function validateMutationOrigin(request: Request) {
  if (["GET", "HEAD", "OPTIONS"].includes(request.method)) return;
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin)
    throw new HttpError(403, "Cross-origin write requests are not allowed.");
}
export async function verifyMojoToken(
  token: string,
  env: RuntimeEnv,
): Promise<Identity> {
  if (!env.MOJOAUTH_JWKS_URL || !env.MOJOAUTH_ISSUER || !env.MOJOAUTH_AUDIENCE)
    throw new HttpError(
      503,
      "Configure MojoAuth JWKS URL, issuer and audience first.",
    );
  const parts = token.split(".");
  if (parts.length !== 3) throw new HttpError(401, "Invalid sign in token.");
  let header: { alg: string; kid: string };
  let claims: Record<string, unknown>;
  try {
    header = JSON.parse(new TextDecoder().decode(bytes(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(bytes(parts[1])));
  } catch {
    throw new HttpError(401, "Invalid sign in token.");
  }
  if (header.alg !== "RS256")
    throw new HttpError(401, "Unsupported sign in signature.");
  const url = new URL(env.MOJOAUTH_JWKS_URL);
  if (url.protocol !== "https:")
    throw new HttpError(503, "MojoAuth key URL must use HTTPS.");
  const response = await fetch(url, { signal: AbortSignal.timeout(7000) });
  if (!response.ok)
    throw new HttpError(503, "MojoAuth signing keys unavailable.");
  const jwks = (await response.json()) as {
    keys: (JsonWebKey & { kid?: string })[];
  };
  const jwk = jwks.keys.find((k) => k.kid === header.kid && k.kty === "RSA");
  if (!jwk) throw new HttpError(401, "Unrecognized sign in key.");
  const key = await crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    bytes(parts[2]),
    encoder.encode(parts[0] + "." + parts[1]),
  );
  const now = Math.floor(Date.now() / 1000);
  const audience = claims.aud;
  if (
    !valid ||
    typeof claims.exp !== "number" ||
    claims.exp <= now ||
    (typeof claims.nbf === "number" && claims.nbf > now + 30) ||
    claims.iss !== env.MOJOAUTH_ISSUER ||
    !(
      audience === env.MOJOAUTH_AUDIENCE ||
      (Array.isArray(audience) && audience.includes(env.MOJOAUTH_AUDIENCE))
    ) ||
    typeof claims.sub !== "string"
  )
    throw new HttpError(401, "Your sign in expired or could not be verified.");
  return {
    id: "mojo:" + claims.sub,
    email: String(claims.email ?? ""),
    name: String(claims.name ?? claims.email ?? "Merchant"),
    provider: "mojoauth",
    email_verified: claims.email_verified === true,
  };
}
async function signSessionPart(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return b64(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(payload)),
    ),
  );
}
export async function makeSessionCookie(identity: Identity, env: RuntimeEnv) {
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32)
    throw new HttpError(503, "Set a session secret of at least 32 characters.");
  const payload = b64(
    encoder.encode(
      JSON.stringify({
        ...identity,
        exp: Math.floor(Date.now() / 1000) + 3600 * 8,
      }),
    ),
  );
  return `ring_session=${payload}.${await signSessionPart(payload, env.SESSION_SECRET)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`;
}
export async function identityFromRequest(
  request: Request,
  env: RuntimeEnv,
): Promise<Identity> {
  const session = request.headers
    .get("cookie")
    ?.split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith("ring_session="))
    ?.slice(13);
  if (session && env.SESSION_SECRET) {
    const [payload, sig] = session.split(".");
    if (
      payload &&
      sig &&
      (await signSessionPart(payload, env.SESSION_SECRET)) === sig
    ) {
      try {
        const user = JSON.parse(new TextDecoder().decode(bytes(payload)));
        if (user.exp > Date.now() / 1000 && typeof user.id === "string")
          return user;
      } catch {
        /* continue to verified auth */
      }
    }
  }
  const bearer = request.headers.get("authorization");
  if (bearer?.startsWith("Bearer ") && env.SUPABASE_URL) {
    if (!env.SUPABASE_PUBLISHABLE_KEY)
      throw new HttpError(503, "Supabase sign-in is not configured.");
    const token = bearer.slice(7).trim();
    if (!token || token.length > 8192)
      throw new HttpError(
        401,
        "Your sign in expired or could not be verified.",
      );
    return verifySupabaseToken(token, env);
  }
  if (bearer?.startsWith("Bearer ") && env.MOJOAUTH_JWKS_URL)
    return verifyMojoToken(bearer.slice(7), env);
  const hostname = new URL(request.url).hostname.toLowerCase();
  const trustSitesHeaders =
    env.TRUST_SITES_HEADERS === "true" ||
    (env.TRUST_SITES_HEADERS !== "false" && hostname.endsWith(".chatgpt.site"));
  const hostedId = trustSitesHeaders
    ? request.headers.get("oai-authenticated-user-id")
    : null;
  if (hostedId) {
    const email = request.headers.get("oai-authenticated-user-email") ?? "";
    let name = request.headers.get("oai-authenticated-user-full-name") ?? "";
    try {
      if (
        request.headers.get("oai-authenticated-user-full-name-encoding") ===
        "percent-encoded-utf-8"
      )
        name = decodeURIComponent(name);
    } catch {
      name = "";
    }
    return {
      id: "sites:" + hostedId,
      email,
      name: name || email.split("@")[0] || "Merchant",
      provider: "sites",
      email_verified: true,
    };
  }
  if (
    ["localhost", "127.0.0.1", "[::1]"].includes(hostname) &&
    !env.MOJOAUTH_JWKS_URL &&
    env.DEMO_MODE !== "false"
  )
    return {
      id: "local-ring-orden-demo",
      email: "hello@ringorden.demo",
      name: "Alex Morgan",
      provider: "local-demo",
      email_verified: true,
    };
  throw new HttpError(401, "Please sign in to access your merchant workspace.");
}

const supabaseIdentityCache = new Map<
  string,
  { identity: Identity; expiresAt: number }
>();
export async function verifySupabaseToken(
  token: string,
  env: RuntimeEnv,
): Promise<Identity> {
  const cached = supabaseIdentityCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new HttpError(503, "Supabase sign-in is not configured.");
  let base: URL;
  try {
    base = new URL(env.SUPABASE_URL);
  } catch {
    throw new HttpError(503, "Supabase URL is invalid.");
  }
  if (base.protocol !== "https:")
    throw new HttpError(503, "Supabase URL must use HTTPS.");
  let response: Response;
  try {
    response = await fetch(new URL("/auth/v1/user", base), {
      headers: {
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(7000),
    });
  } catch {
    throw new HttpError(503, "Supabase sign-in could not be reached.");
  }
  if (!response.ok)
    throw new HttpError(401, "Your sign in expired or could not be verified.");
  const user = (await response.json()) as Record<string, unknown>;
  if (typeof user.id !== "string" || typeof user.email !== "string")
    throw new HttpError(401, "Your sign in expired or could not be verified.");
  const identity: Identity = {
    id: "supabase:" + user.id,
    email: user.email,
    name:
      (typeof user.user_metadata === "object" &&
      user.user_metadata !== null &&
      typeof (user.user_metadata as Record<string, unknown>).full_name ===
        "string"
        ? String((user.user_metadata as Record<string, unknown>).full_name)
        : user.email.split("@")[0]) || "Merchant",
    provider: "supabase",
    email_verified: Boolean(user.email_confirmed_at),
  };
  if (supabaseIdentityCache.size > 1000) supabaseIdentityCache.clear();
  supabaseIdentityCache.set(token, {
    identity,
    expiresAt: Date.now() + 30_000,
  });
  return identity;
}
export async function sha256Hex(value: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export function newInvitationToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Keep the canonical workspace subject when a verified email moves providers. */
export async function linkMojoIdentity(
  identity: Identity,
  env: RuntimeEnv,
): Promise<Identity> {
  if (identity.email_verified !== true || !identity.email.trim())
    throw new HttpError(
      401,
      "A verified email address is required to sign in.",
    );
  if (!env.SUPABASE_URL) return identity;
  if (!env.SUPABASE_SERVER_SECRET)
    throw new HttpError(503, "Account linking is not configured.");
  const origin = new URL(env.SUPABASE_URL);
  if (origin.protocol !== "https:" || origin.username || origin.password)
    throw new HttpError(503, "Account linking is not configured.");
  for (let page = 1; page <= 10; page++) {
    let response: Response;
    try {
      response = await fetch(
        new URL(`/auth/v1/admin/users?page=${page}&per_page=1000`, origin),
        {
          headers: {
            apikey: env.SUPABASE_SERVER_SECRET,
            ...(env.SUPABASE_SERVER_SECRET.startsWith("sb_secret_")
              ? {}
              : { Authorization: `Bearer ${env.SUPABASE_SERVER_SECRET}` }),
          },
          redirect: "error",
          signal: AbortSignal.timeout(7000),
        },
      );
    } catch {
      throw new HttpError(
        503,
        "Account lookup is unavailable. Please try again.",
      );
    }
    if (!response.ok)
      throw new HttpError(
        503,
        "Account lookup is unavailable. Please try again.",
      );
    const result = (await response.json()) as {
      users?: {
        id?: string;
        email?: string;
        email_confirmed_at?: string;
        banned_until?: string;
      }[];
    };
    if (!Array.isArray(result.users))
      throw new HttpError(503, "Account lookup returned an invalid response.");
    const matches = result.users.filter(
      (user) =>
        typeof user.email === "string" &&
        user.email.trim().toLowerCase() === identity.email.trim().toLowerCase(),
    );
    if (matches.length > 1)
      throw new HttpError(409, "Account linking requires support.");
    const existing = matches[0];
    if (
      existing?.banned_until &&
      Date.parse(existing.banned_until) > Date.now()
    )
      throw new HttpError(403, "This account is disabled.");
    if (existing?.email_confirmed_at && typeof existing.id === "string")
      return { ...identity, id: "supabase:" + existing.id };
    if (result.users.length < 1000) return identity;
  }
  throw new HttpError(
    503,
    "Account lookup needs support before sign-in can continue.",
  );
}
