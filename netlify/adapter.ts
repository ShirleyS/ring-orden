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
  // Netlify verifies private-project login before invoking the function.
  // Trust that platform-supplied identity instead of rechecking its expiry.
  if (user?.id) {
    headers.set("oai-authenticated-user-id", "netlify:" + user.id);
    if (user.email) headers.set("oai-authenticated-user-email", user.email);
    env.TRUST_SITES_HEADERS = "true";
  }
  return { request: new Request(request, { headers }), env };
}
