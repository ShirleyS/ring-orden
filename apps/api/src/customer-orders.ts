import { z } from "zod";
import {
  applyOperations,
  applyOperation,
  priceOrder,
  OperationSchema,
} from "../../../packages/ring-orden-core/src/index.ts";
import type {
  Order,
  PricingRules,
} from "../../../packages/ring-orden-core/src/index.ts";
import { HttpError, sha256Hex } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { Repository, TenantState } from "./types.ts";
import { billingSummary, saveBillingDetails } from "./customer-receipts.ts";

const draftStatuses = new Set([
  "DRAFT",
  "AWAITING_CLARIFICATION",
  "AWAITING_CONFIRMATION",
]);
const payableStatuses = new Set([
  "CONFIRMED",
  "PAYMENT_PENDING",
  "POS_SYNC_PENDING",
  "POS_SYNCED",
  "POS_SYNC_FAILED",
]);
const editableActions = new Set([
  "add_item",
  "remove_item",
  "modify_item",
  "change_quantity",
  "add_modifier",
  "remove_modifier",
  "set_customer_name",
  "set_fulfillment",
  "set_pickup_time",
  "add_note",
]);
const itemActions = new Set([
  "add_item",
  "remove_item",
  "modify_item",
  "change_quantity",
  "add_modifier",
  "remove_modifier",
]);
const routingId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[a-zA-Z0-9_-]+$/);
const envelopeSchema = z
  .object({
    merchant_id: routingId,
    order_id: routingId,
    secret: z.string().regex(/^[a-f0-9]{64}$/),
    scope: z.literal("receipt").optional(),
  })
  .strict();
const revisionSchema = z.number().int().nonnegative();
const patchSchema = z
  .object({
    revision: revisionSchema,
    operations: z
      .array(OperationSchema)
      .min(1)
      .max(20)
      .refine(
        (ops) => ops.every((op) => editableActions.has(op.action)),
        "This action requires restaurant assistance.",
      ),
  })
  .strict();
const confirmSchema = z
  .object({
    revision: revisionSchema,
    reviewed_total: z.number().finite().nonnegative(),
    confirmed: z.literal(true),
  })
  .strict();

export interface CustomerOrderServices {
  rules(state: TenantState): PricingRules;
  orderingAllowed(state: TenantState, env: RuntimeEnv, order: Order): boolean;
  confirm(
    state: TenantState,
    order: Order,
    env: RuntimeEnv,
    origin: string,
  ): Promise<Order>;
  deliver(
    repo: Repository,
    merchantId: string,
    orderId: string,
    env: RuntimeEnv,
    origin: string,
    returnUrls?: { success: string; cancel: string },
  ): Promise<Order | undefined>;
}

/** One explicitly configured origin; never trust an origin supplied by the caller. */
export function customerOrigin(env: RuntimeEnv): string {
  try {
    const url = new URL(String(env.CUSTOMER_APP_ORIGIN ?? ""));
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new HttpError(
      503,
      "Configure CUSTOMER_APP_ORIGIN as the customer app's HTTPS origin.",
    );
  }
}

function canEdit(order: Order) {
  return draftStatuses.has(order.status) && order.payment_status === "PENDING";
}
function canPay(order: Order) {
  return (
    payableStatuses.has(order.status) &&
    ["PENDING", "PAYMENT_ERROR"].includes(order.payment_status)
  );
}

/** Permit intermediate repairs, then validate the complete result against the real menu. */
function repairCatalog(state: TenantState, order: Order) {
  const catalog = structuredClone(state.catalog);
  for (const line of order.items) {
    let item = catalog.find((item) => item.id === line.catalog_item_id);
    if (!item) {
      item = {
        id: line.catalog_item_id,
        name: line.name,
        price: line.unit_price,
        category: "Existing order",
        available: true,
        modifiers: [],
      };
      catalog.push(item);
    }
    for (const modifier of line.modifiers)
      if (!item.modifiers.some((m) => m.id === modifier.modifier_id))
        item.modifiers.push({
          id: modifier.modifier_id,
          name: modifier.name,
          price_delta: modifier.price_delta,
          available: true,
        });
  }
  for (const item of catalog) {
    item.available = true;
    for (const modifier of item.modifiers) modifier.available = true;
  }
  return catalog;
}

/** The random credential is returned once; the durable state keeps only its digest. */
export async function issueCustomerOrderLink(
  state: TenantState,
  order: Order,
  env: RuntimeEnv,
  scope: "order" | "receipt" = "order",
) {
  const origin = customerOrigin(env);
  if (scope === "receipt" && draftStatuses.has(order.status))
    throw new HttpError(409, "Confirm this order before creating a receipt.");
  if (scope === "order" &&
    order.merchant_id !== state.merchant.id ||
    !state.orders.some((o) => o.id === order.id)
  )
    throw new HttpError(404, "Order not found in your workspace.");
  if (
    ["CANCELLED", "REFUND_PENDING", "REFUNDED", "ESCALATED"].includes(
      order.status,
    )
  )
    throw new HttpError(409, "This order requires restaurant assistance.");
  const secret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const token = btoa(
    JSON.stringify({
      merchant_id: state.merchant.id,
      order_id: order.id,
      secret,
      ...(scope === "receipt" ? {scope} : {}),
    }),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const expires_at = new Date(Date.now() + (scope === "receipt" ? 7 * 86400_000 : 60 * 60_000)).toISOString();
  state.order_metadata[order.id] ??= {
    pos_status: "DASHBOARD_ONLY",
    notification_status: "PENDING",
    demo: env.DEMO_MODE !== "false",
  };
  state.order_metadata[order.id][scope === "receipt" ? "receipt_link" : "customer_link"] = {
    hash: await sha256Hex(token),
    expires_at,
  };
  return { url: `${origin}/${scope === "receipt" ? "receipt" : "order"}#${token}`, expires_at };
}

export const issueCustomerReceiptLink = (state: TenantState, order: Order, env: RuntimeEnv) =>
  issueCustomerOrderLink(state, order, env, "receipt");
export function revokeCustomerReceiptLink(state: TenantState, orderId: string) {
  delete state.order_metadata[orderId]?.receipt_link;
  return {revoked:true};
}

export function revokeCustomerOrderLink(state: TenantState, orderId: string) {
  delete state.order_metadata[orderId]?.customer_link;
  return { revoked: true };
}

async function authenticate(request: Request, repo: Repository) {
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{80,1600})$/)?.[1];
  const invalid = () =>
    new HttpError(
      401,
      "This order link is invalid, expired, or has been replaced. Ask the restaurant for a new link.",
    );
  if (!token) throw invalid();
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(
      JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/"))),
    );
  } catch {
    throw invalid();
  }
  const stored = await repo.loadByMerchant(envelope.merchant_id);
  const order = stored?.state.orders.find(
    (o) => o.id === envelope.order_id && o.merchant_id === envelope.merchant_id,
  );
  const scope = envelope.scope ?? "order";
  const grant = stored?.state.order_metadata[envelope.order_id]?.[scope === "receipt" ? "receipt_link" : "customer_link"];
  const digest = await sha256Hex(token);
  let difference = 0;
  const expected = grant?.hash ?? "0".repeat(64);
  for (let i = 0; i < 64; i++)
    difference |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  if (
    !stored ||
    !order ||
    !grant ||
    difference ||
    !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= Date.now()
  )
    throw invalid();
  return { stored, order, expires_at: grant.expires_at, scope };
}

function customerView(
  state: TenantState,
  input: Order,
  expires_at: string,
  services: CustomerOrderServices,
) {
  let order = input;
  const problems: string[] = [];
  if (canEdit(order)) {
    try {
      order = priceOrder(order, state.catalog, services.rules(state));
    } catch (error) {
      problems.push(
        error instanceof Error
          ? error.message
          : "Please review unavailable items with the restaurant.",
      );
    }
  }
  return {
    merchant: {
      name: state.merchant.name,
      currency: state.merchant.currency,
      language: state.merchant.language,
    },
    order: {
      reference: order.external_reference,
      customer_name: order.customer.name,
      items: order.items.map((line) => ({
        line_id: line.line_id,
        catalog_item_id: line.catalog_item_id,
        name: line.name,
        quantity: line.quantity,
        unit_price: line.unit_price,
        modifiers: line.modifiers,
      })),
      fulfillment: order.fulfillment,
      subtotal: order.subtotal,
      tax: order.tax,
      fees: order.fees,
      total: order.total,
      currency: order.currency,
      revision: order.revision,
      status: order.status,
      payment_status: order.payment_status,
      clarification: order.clarification ?? null,
    },
    catalog: canEdit(order)
      ? state.catalog.map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          category: item.category,
          price: item.price,
          available: item.available,
          modifiers: item.modifiers,
        }))
      : [],
    editable: canEdit(order),
    can_pay: canPay(order),
    expires_at,
    demo: state.order_metadata[order.id]?.demo === true,
    problems,
  };
}

async function readBody(request: Request) {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Content-Type must be application/json.");
  if (Number(request.headers.get("Content-Length") ?? 0) > 16_384)
    throw new HttpError(413, "Request is too large.");
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return size ? JSON.parse(new TextDecoder().decode(bytes)) : {};
  } catch {
    throw new HttpError(400, "A valid JSON request is required.");
  }
}

/** This surface accepts only an order-specific capability, never a merchant session. */
export async function handleCustomerOrderRequest(
  request: Request,
  env: RuntimeEnv,
  repo: Repository,
  services: CustomerOrderServices,
): Promise<Response> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  const json = (value: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(value), {
      status,
      headers,
    });
  try {
    const route = new URL(request.url).pathname;
    const allowed = new Map([
      ["/api/customer/order", ["GET", "PATCH", "OPTIONS"]],
      ["/api/customer/confirm", ["POST", "OPTIONS"]],
      ["/api/customer/checkout", ["POST", "OPTIONS"]],
      ["/api/customer/receipt", ["GET", "OPTIONS"]],
      ["/api/customer/billing", ["PUT", "OPTIONS"]],
    ]);
    const methods = allowed.get(route);
    if (!methods) throw new HttpError(404, "Endpoint not found.");
    const origin = customerOrigin(env);
    const callerOrigin = request.headers.get("Origin");
    if (callerOrigin && callerOrigin !== origin)
      throw new HttpError(403, "This customer app origin is not allowed.");
    if (callerOrigin) headers["Access-Control-Allow-Origin"] = origin;
    if (!methods.includes(request.method))
      throw new HttpError(405, "Method not allowed.");
    if (request.method === "OPTIONS") {
      const requestedMethod = request.headers.get(
        "Access-Control-Request-Method",
      );
      if (requestedMethod && !methods.includes(requestedMethod))
        throw new HttpError(405, "Method not allowed.");
      headers["Access-Control-Allow-Methods"] = methods.join(", ");
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
      return json(null, 204);
    }
    const {
      stored,
      order: originalOrder,
      expires_at,
      scope,
    } = await authenticate(request, repo);
    if (scope === "receipt" && !["/api/customer/receipt", "/api/customer/billing", "/api/customer/checkout"].includes(route))
      throw new HttpError(403,"This receipt link cannot change or confirm an order.");
    if (scope !== "receipt" && ["/api/customer/receipt", "/api/customer/billing"].includes(route))
      throw new HttpError(403,"Use the receipt link to access billing.");
    const state = stored.state;
    let order = originalOrder;
    if (request.method === "GET") {
      const view=customerView(state,order,expires_at,services);
      return json(scope === "receipt" ? {...view,editable:false,catalog:[],billing:billingSummary(state,order.id)} : view);
    }
    const body = await readBody(request);
    if (route.endsWith("/billing")) {
      if (draftStatuses.has(order.status)) throw new HttpError(409,"Confirm the order before submitting billing details.");
      const result=saveBillingDetails(state,order.id,body);
      if (!(await repo.saveTrusted(state.merchant.id,stored.revision,state)))
        throw new HttpError(409,"Billing details changed. Refresh and try again.");
      return json(result);
    }
    if (route.endsWith("/checkout")) {
      z.object({}).strict().parse(body);
      if (!canPay(order))
        throw new HttpError(
          409,
          "Only a confirmed unpaid order can open checkout.",
        );
      const checkoutUrl = state.order_metadata[order.id]?.checkout_url;
      if (!checkoutUrl)
        throw new HttpError(
          503,
          "Online payment is not ready for this order. Please contact the restaurant.",
        );
      const destination = new URL(checkoutUrl);
      if (
        destination.protocol !== "https:" ||
        destination.hostname !== "checkout.stripe.com" ||
        destination.username ||
        destination.password
      )
        throw new HttpError(
          503,
          "Online payment is not ready for this order. Please contact the restaurant.",
        );
      return json({ checkout_url: checkoutUrl });
    }
    if (route.endsWith("/confirm")) {
      const input = confirmSchema.parse(body);
      // Confirmation is idempotent: never repeat fulfillment or create another checkout.
      if (canPay(order) || order.payment_status === "PAID")
        return json(customerView(state, order, expires_at, services));
      if (!canEdit(order))
        throw new HttpError(409, "This order requires restaurant assistance.");
      if (input.revision !== order.revision)
        throw new HttpError(
          409,
          "Your order changed. Refresh and review it before confirming.",
        );
      if (
        state.settings.agent.enabled === false ||
        !services.orderingAllowed(state, env, order)
      )
        throw new HttpError(
          409,
          "The restaurant is currently closed for ordering.",
        );
      let quoted: Order;
      try {
        quoted = priceOrder(order, state.catalog, services.rules(state));
      } catch (error) {
        throw new HttpError(
          409,
          error instanceof Error ? error.message : "Please review your order.",
        );
      }
      if (
        Math.round(input.reviewed_total * 100) !==
        Math.round(quoted.total * 100)
      )
        throw new HttpError(
          409,
          "Prices have changed. Refresh and review the new total before confirming.",
        );
      try {
        order = applyOperation(
          quoted,
          { action: "confirm_order", confirmed: true },
          state.catalog,
          services.rules(state),
        );
      } catch (error) {
        throw new HttpError(
          409,
          error instanceof Error ? error.message : "Please review your order.",
        );
      }
      order = await services.confirm(
        state,
        order,
        env,
        new URL(request.url).origin,
      );
    } else {
      const input = patchSchema.parse(body);
      if (!canEdit(order))
        throw new HttpError(
          409,
          "This order is confirmed. Contact the restaurant to make changes.",
        );
      if (input.revision !== order.revision)
        throw new HttpError(
          409,
          "Your order changed. Refresh it before making changes.",
        );
      order = applyOperations(
        order,
        input.operations,
        repairCatalog(state, order),
        services.rules(state),
      );
      order = priceOrder(order, state.catalog, services.rules(state));
      if (
        originalOrder.clarification &&
        !input.operations.some((op) => itemActions.has(op.action))
      ) {
        order.status = "AWAITING_CLARIFICATION";
        order.clarification = originalOrder.clarification;
      }
    }
    state.orders[state.orders.findIndex((o) => o.id === order.id)] = order;
    if (!(await repo.saveTrusted(state.merchant.id, stored.revision, state)))
      throw new HttpError(
        409,
        "Your order changed. Refresh and review it before continuing.",
      );
    if (route.endsWith("/confirm")) {
      await services.deliver(
        repo,
        state.merchant.id,
        order.id,
        env,
        new URL(request.url).origin,
        {
          success: `${origin}/order?payment=returned`,
          cancel: `${origin}/order?payment=cancelled`,
        },
      );
      const latest = await repo.loadByMerchant(state.merchant.id);
      if (latest)
        return json(
          customerView(
            latest.state,
            latest.state.orders.find((o) => o.id === order.id)!,
            expires_at,
            services,
          ),
        );
    }
    return json(customerView(state, order, expires_at, services));
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        { error: error.issues.map((issue) => issue.message).join("; ") },
        422,
      );
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Your order could not be updated. Please try again.",
      },
      400,
    );
  }
}
