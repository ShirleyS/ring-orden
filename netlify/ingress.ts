import type { RuntimeEnv } from "../apps/api/src/auth.ts";
import { handleRequest } from "../apps/api/src/server.ts";
import type { Repository } from "../apps/api/src/types.ts";

const agentTools = new Set([
  "create_session",
  "get_business_info",
  "get_menu",
  "get_order_state",
  "process_order_turn",
  "confirm_order",
  "get_pickup_options",
  "request_human",
  "escalate_issue",
]);
const maximumBodyBytes = 128 * 1024;

function jsonError(status: number, error: string) {
  return Response.json(
    { error },
    {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'",
        "Referrer-Policy": "no-referrer",
        "X-Frame-Options": "DENY",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function ingressRoute(request: Request): "agent" | "stripe" | "health" | null {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health" && request.method === "GET") return "health";
  if (pathname === "/api/webhooks/stripe" && request.method === "POST")
    return "stripe";
  const tool = pathname.match(/^\/api\/tools\/([a-z_]+)$/)?.[1];
  if (request.method === "POST" && tool && agentTools.has(tool)) return "agent";
  return null;
}

async function bufferBody(request: Request): Promise<Request | Response> {
  if (!request.body) return request;
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maximumBodyBytes)
    return jsonError(413, "Request body is too large.");

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maximumBodyBytes) {
      await reader.cancel();
      return jsonError(413, "Request body is too large.");
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const headers = new Headers(request.headers);
  headers.delete("content-length");
  return new Request(request.url, {
    method: request.method,
    headers,
    body: bytes,
  });
}

/** Public API surface for third-party callbacks, isolated from the merchant app. */
export async function handlePublicIngress(
  request: Request,
  env: RuntimeEnv,
  repository?: Repository,
): Promise<Response> {
  const route = ingressRoute(request);
  if (!route) return jsonError(404, "Endpoint not found.");

  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVER_SECRET ||
    (route !== "health" && route === "agent" &&
      (!env.AGENT_TOOL_SECRET || !env.AGENT_MERCHANT_ID)) ||
    (route === "stripe" && !env.STRIPE_WEBHOOK_SECRET)
  )
    return jsonError(503, "Public API ingress is not configured.");

  if (route !== "health") {
    const contentType = request.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().startsWith("application/json"))
      return jsonError(415, "Content-Type must be application/json.");
    const buffered = await bufferBody(request);
    if (buffered instanceof Response) return buffered;
    request = buffered;
  }

  if (route === "health")
    return Response.json(
      { status: "ok" },
      {
        headers: {
          "Cache-Control": "no-store",
          "Content-Security-Policy": "default-src 'none'",
          "Referrer-Policy": "no-referrer",
          "X-Content-Type-Options": "nosniff",
        },
      },
    );

  const headers = new Headers(request.headers);
  for (const key of [...headers.keys()])
    if (key.toLowerCase().startsWith("oai-")) headers.delete(key);

  const response = await handleRequest(
    new Request(request, { headers }),
    {
      ...env,
      DEMO_MODE: "false",
      TRUST_SITES_HEADERS: "false",
    },
    repository,
  );
  const responseHeaders = new Headers(response.headers);
  responseHeaders.set("Content-Security-Policy", "default-src 'none'");
  responseHeaders.set("Referrer-Policy", "no-referrer");
  responseHeaders.set("X-Frame-Options", "DENY");
  responseHeaders.set("X-Content-Type-Options", "nosniff");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
