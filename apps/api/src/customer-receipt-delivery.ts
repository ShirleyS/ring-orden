import { HttpError } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
import type { Repository, TenantState, OrderMetadata } from "./types.ts";
import { issueCustomerReceiptLink } from "./customer-orders.ts";
import { sendReceiptWhatsApp } from "./payments.ts";

export function receiptRetryAllowed(
  notification: OrderMetadata["receipt_notification"],
  now = Date.now(),
) {
  return (
    notification?.status !== "PROCESSING" ||
    Date.parse(notification.updated_at) <= now - 10 * 60000
  );
}

export function recordReceiptConsent(
  state: TenantState,
  order: Order,
  consent: boolean | undefined,
) {
  if (consent !== true) return;
  if (!order.customer.phone || !/^\+\d{8,15}$/.test(order.customer.phone))
    throw new HttpError(
      422,
      "A valid customer phone number is needed for a WhatsApp receipt.",
    );
  state.order_metadata[order.id].receipt_consent = {
    phone: order.customer.phone,
    recorded_at: new Date().toISOString(),
  };
}

/** A durable claim prevents automatic duplicates. Only explicit owner retries rotate a prior receipt. */
export async function sendPendingCustomerReceipt(
  repo: Repository,
  merchantId: string,
  orderId: string,
  env: RuntimeEnv,
  explicitRetry = false,
) {
  const stored = await repo.loadByMerchant(merchantId);
  if (!stored) throw new HttpError(404, "Order not found.");
  const state = stored.state;
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) throw new HttpError(404, "Order not found.");
  const meta = state.order_metadata[orderId];
  if (
    !meta?.receipt_consent ||
    meta.receipt_consent.phone !== order.customer.phone
  )
    return { status: "CONSENT_REQUIRED" };
  if (
    [
      "DRAFT",
      "AWAITING_CLARIFICATION",
      "AWAITING_CONFIRMATION",
      "ESCALATED",
    ].includes(order.status)
  )
    throw new HttpError(409, "Confirm the order before sending a receipt.");
  const previous = meta.receipt_notification;
  if (previous && !explicitRetry) return { status: previous.status };
  if (!receiptRetryAllowed(previous))
    throw new HttpError(
      409,
      "A receipt message is already processing. Check its status before retrying.",
    );
  const demo = env.DEMO_MODE !== "false" || order.source === "demo";
  const configured = Boolean(
    env.TWILIO_ACCOUNT_SID &&
      env.TWILIO_AUTH_TOKEN &&
      env.TWILIO_WHATSAPP_FROM &&
      env.TWILIO_RECEIPT_TEMPLATE_SID &&
      state.settings.notifications.whatsapp,
  );
  const claim = crypto.randomUUID();
  const now = new Date().toISOString();
  let link: { url: string; expires_at: string } | undefined;
  if (demo || configured)
    link = await issueCustomerReceiptLink(state, order, env);
  meta.receipt_notification = {
    claim,
    status: demo
      ? "DEMO_PREVIEW"
      : configured
        ? "PROCESSING"
        : "NOT_CONFIGURED",
    updated_at: now,
  };
  if (!(await repo.saveTrusted(merchantId, stored.revision, state)))
    throw new HttpError(
      409,
      "The order changed. Refresh before sending a receipt.",
    );
  if (demo || !configured) return { status: meta.receipt_notification.status };
  let outcome: { status: string; provider_id?: string };
  try {
    const result = await sendReceiptWhatsApp(order, link!.url, env);
    outcome = {
      status: [
        "queued",
        "accepted",
        "scheduled",
        "sending",
        "sent",
        "delivered",
        "read",
        "failed",
        "undelivered",
      ].includes(result.status.toLowerCase())
        ? result.status.toUpperCase()
        : "UNKNOWN",
      provider_id: result.id,
    };
  } catch (error) {
    // A transport failure may happen after Twilio accepted the message: do not auto-retry.
    outcome = { status: error instanceof HttpError ? "FAILED" : "UNKNOWN" };
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await repo.loadByMerchant(merchantId);
    const current = latest?.state.order_metadata[orderId]?.receipt_notification;
    if (!latest || current?.claim !== claim) return { status: outcome.status };
    latest.state.order_metadata[orderId].receipt_notification = {
      ...current,
      ...outcome,
      updated_at: new Date().toISOString(),
    };
    if (await repo.saveTrusted(merchantId, latest.revision, latest.state))
      return { status: outcome.status };
  }
  return { status: "UNKNOWN" };
}
