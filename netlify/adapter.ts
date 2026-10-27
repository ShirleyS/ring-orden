import type { RuntimeEnv } from "../apps/api/src/auth.ts";
export interface NetlifyRequestContext {
  user?: { id: string; email?: string; expiresAt?: Date | string };
}
/** Only the host-verified login context can establish a merchant identity. */
export function adaptNetlifyRequest(
  request: Request,
  context: NetlifyRequestContext,
  environment: RuntimeEnv,
): { request: Request; env: RuntimeEnv } {
  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()])
    if (key.toLowerCase().startsWith("oai-")) headers.delete(key);
  const env = { ...environment, TRUST_SITES_HEADERS: "false" };
  const user = context.user;
  const expires = user?.expiresAt ? new Date(user.expiresAt).getTime() : NaN;
  if (user?.id && Number.isFinite(expires) && expires > Date.now()) {
    headers.set("oai-authenticated-user-id", "netlify:" + user.id);
    if (user.email) headers.set("oai-authenticated-user-email", user.email);
    env.TRUST_SITES_HEADERS = "true";
  }
  return { request: new Request(request, { headers }), env };
}
