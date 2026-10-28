import type { MerchantRole, TenantState } from "./types.ts";
import { HttpError } from "./auth.ts";
export function guardMerchantRoute(
  role: MerchantRole,
  path: string[],
  method: string,
  body?: Record<string, unknown>,
) {
  if (role === "OWNER") return;
  if (path[0] === "customers") {
    if (
      role === "MANAGER" &&
      path[2] !== "billing" &&
      path[2] !== "verification-link"
    )
      return;
    throw new HttpError(
      403,
      "Customer access requires an authorized owner or manager.",
    );
  }
  if (
    ["customer-link", "receipt-link", "receipt-send", "billing"].includes(
      path[2],
    )
  )
    throw new HttpError(403, "Only the owner can manage customer order links.");
  const route = path[0];
  if (method === "GET") {
    if (["bootstrap", "orders", "sessions", "health"].includes(route)) return;
    throw new HttpError(
      403,
      "Your workspace role does not have access to this page.",
    );
  }
  if (role === "MANAGER") {
    if (
      route === "sessions" ||
      route === "orders" ||
      route === "memories" ||
      route === "escalations" ||
      route === "voice"
    ) {
      if (
        route === "orders" &&
        body?.action &&
        ["checkout", "demo_pay", "retry_notification"].includes(
          String(body.action),
        )
      )
        throw new HttpError(
          403,
          "Only the owner can manage payments and customer notifications.",
        );
      return;
    }
    if (
      route === "menu" &&
      method === "PATCH" &&
      body &&
      Object.keys(body).every((key) => key === "available")
    )
      return;
  }
  if (
    role === "STAFF" &&
    route === "orders" &&
    path[2] === "action" &&
    ["prepare", "ready", "complete"].includes(String(body?.action))
  )
    return;
  throw new HttpError(403, "Your workspace role does not allow this action.");
}
export function redactWorkspace(
  workspace: Record<string, unknown>,
  role: MerchantRole,
): Record<string, unknown> {
  if (role === "OWNER") return workspace;
  const result = {
    ...workspace,
    orders: (workspace.orders as Record<string, unknown>[]).map((order) =>
      redactOrderForRole(order, role),
    ),
    team: [],
    settings: {},
    integrations: [],
    menu_imports: [],
  };
  if (role === "STAFF") {
    const orders = (result.orders as { status: string; id: string }[]).filter(
      (o) =>
        [
          "CONFIRMED",
          "PAYMENT_PENDING",
          "PAID",
          "POS_SYNC_PENDING",
          "POS_SYNCED",
          "POS_SYNC_FAILED",
          "PREPARING",
          "READY",
          "ESCALATED",
        ].includes(o.status),
    );
    const activeIds = new Set(orders.map((o) => o.id));
    return {
      ...result,
      merchant: {
        ...(workspace.merchant as Record<string, unknown>),
        notification_phone: "",
      },
      orders,
      memories: [],
      events: [],
      escalations: [],
      catalog: [],
      stats: {},
      calls: (
        workspace.calls as {
          order_id: string;
          id: string;
          status: string;
          created_at: string;
          customer?: string;
          duration?: number;
        }[]
      )
        .filter((c) => activeIds.has(c.order_id))
        .map((c) => ({
          id: c.id,
          order_id: c.order_id,
          status: c.status,
          created_at: c.created_at,
          customer: c.customer,
          duration: c.duration,
        })),
    };
  }
  // Managers may manage availability, orders, escalation and confirmed memory.
  return {
    ...result,
    events: (workspace.events as { type: string }[]).filter((e) =>
      /^(order|menu|memory|escalation)\./.test(e.type),
    ),
  };
}
export function redactOrderForRole<T extends Record<string, unknown>>(
  order: T,
  role: MerchantRole,
): T {
  const result: Record<string, unknown> = { ...order };
  delete result.billing;
  if (role === "OWNER") return result as T;
  delete result.checkout_url;
  delete result.checkout_id;
  delete result.customer_link;
  delete result.receipt_link;
  delete result.receipt_consent;
  delete result.receipt_notification;
  if (role === "STAFF") {
    delete result.customer_phone;
    if (result.customer && typeof result.customer === "object")
      result.customer = { ...result.customer, phone: null };
  }
  return result as T;
}
