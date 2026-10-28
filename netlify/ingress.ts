import type { RuntimeEnv } from "../apps/api/src/auth.ts";
import { configuredAgentSecret } from "../apps/api/src/auth.ts";
import { handleRequest } from "../apps/api/src/server.ts";
import type { Repository } from "../apps/api/src/types.ts";

const agentTools = new Set([
  "create_session",
  "get_business_info",
  "get_menu",
  "get_order_state",
  "process_order_turn",
  "apply_order_operations",
  "confirm_order",
  "get_pickup_options",
  "request_human",
  "escalate_issue",
  "customer_link",
  "get_customer_context",
  "get_customer_preferences",
  "update_customer_preference",
  "get_previous_orders",
  "reorder_previous_order",
  "get_billing_profile_status",
  "request_invoice",
  "verify_customer",
  "customer_followup",
  "set_customer_followup_consent",
]);
const maximumBodyBytes = 128 * 1024;
const automationTools = new Set([
  "health",
  "retry_failed_pos",
  "model_health",
  "get_memory_context",
  "claim_automation_jobs",
  "ack_automation_job",
]);

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

function ingressRoute(
  request: Request,
):
  | "agent"
  | "automation"
  | "stripe"
  | "elevenlabs"
  | "health"
  | "customer"
  | null {
  const { pathname } = new URL(request.url);
  if (pathname === "/api/health" && request.method === "GET") return "health";
  const customerMethods: Record<string, string[]> = {
    "/api/customer/order": ["GET", "PATCH", "OPTIONS"],
    "/api/customer/confirm": ["POST", "OPTIONS"],
    "/api/customer/checkout": ["POST", "OPTIONS"],
    "/api/customer/receipt": ["GET", "OPTIONS"],
    "/api/customer/billing": ["GET", "POST", "OPTIONS"],
    "/api/customer/verify": ["POST", "OPTIONS"],
  };
  if (customerMethods[pathname]?.includes(request.method)) return "customer";
  if (pathname === "/api/webhooks/stripe" && request.method === "POST")
    return "stripe";
  if (pathname === "/api/webhooks/elevenlabs" && request.method === "POST")
    return "elevenlabs";
  const automation = pathname.match(/^\/api\/automation\/([a-z_]+)$/)?.[1];
  if (
    request.method === "POST" &&
    automation &&
    automationTools.has(automation)
  )
    return "automation";
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
  const serviceSecret = configuredAgentSecret(env);
  if (
    ["health", "agent", "automation"].includes(route) &&
    env.AGENT_TOOL_SECRET &&
    !serviceSecret
  )
    return jsonError(503, "AGENT_TOOL_SECRET configuration is invalid.");
  env = { ...env, AGENT_TOOL_SECRET: serviceSecret };

  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_SERVER_SECRET ||
    ((route === "agent" || route === "automation") &&
      (!env.AGENT_TOOL_SECRET || !env.AGENT_MERCHANT_ID)) ||
    (route === "stripe" && !env.STRIPE_WEBHOOK_SECRET) ||
    (route === "elevenlabs" &&
      (!env.ELEVENLABS_WEBHOOK_SECRET ||
        !env.AGENT_MERCHANT_ID ||
        !env.ELEVENLABS_AGENT_ID))
  )
    return jsonError(503, "Public API ingress is not configured.");

  if (route !== "health" && !["GET", "OPTIONS"].includes(request.method)) {
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

  const target = new URL(request.url);
  if (route === "automation")
    target.pathname =
      target.pathname === "/api/automation/health"
        ? "/api/tools/get_business_info"
        : target.pathname.replace("/api/automation/", "/api/tools/");
  const forwarded =
    route === "automation"
      ? new Request(target, {
          method: request.method,
          headers,
          body: await request.arrayBuffer(),
        })
      : new Request(request, { headers });
  const response = await handleRequest(
    forwarded,
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
  if (
    new URL(request.url).pathname === "/api/automation/health" &&
    response.ok
  ) {
    await response.body?.cancel();
    return Response.json(
      { status: "ok", merchant_bound: true },
      { headers: responseHeaders },
    );
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  });
}
