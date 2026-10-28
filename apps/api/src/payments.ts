import type { RuntimeEnv } from "./auth.ts";
import { twilioAuthorization } from "./twilio-auth.ts";
import { HttpError } from "./auth.ts";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
export async function hmacHex(
  secret: string,
  message: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return Array.from(
    new Uint8Array(
      await crypto.subtle.sign("HMAC", key, encoder.encode(message)),
    ),
  )
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function verifyStripeSignature(
  rawBody: string,
  header: string,
  secret: string,
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const parts = header.split(",").map((p) => p.split("="));
  const stamp = parts.find((p) => p[0] === "t")?.[1];
  const signatures = parts.filter((p) => p[0] === "v1").map((p) => p[1]);
  if (
    !stamp ||
    !Number.isFinite(Number(stamp)) ||
    Math.abs(now - Number(stamp)) > 300
  )
    return false;
  const expected = await hmacHex(secret, `${stamp}.${rawBody}`);
  return signatures.some((signature) => {
    if (signature.length !== expected.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++)
      diff |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    return diff === 0;
  });
}
export function validatePaidSession(
  session: {
    payment_status?: unknown;
    amount_total?: unknown;
    currency?: unknown;
  },
  total: number,
  currency: string,
): boolean {
  return (
    session.payment_status === "paid" &&
    session.amount_total === Math.round(total * 100) &&
    session.currency === currency.toLowerCase()
  );
}
export async function createCheckout(
  order: Order,
  env: RuntimeEnv,
): Promise<{ id: string; url: string }> {
  if (
    !env.STRIPE_SECRET_KEY?.startsWith("sk_test_") &&
    !env.STRIPE_SECRET_KEY?.startsWith("rk_test_")
  )
    throw new HttpError(
      503,
      "Connect a Stripe test-mode key to create a checkout link.",
    );
  const configuredOrigin = env.APP_ORIGIN?.trim();
  if (!configuredOrigin)
    throw new HttpError(
      503,
      "Set APP_ORIGIN to the public payment-return site before creating Checkout.",
    );
  let checkoutOrigin: URL;
  try {
    checkoutOrigin = new URL(configuredOrigin);
  } catch {
    throw new HttpError(503, "APP_ORIGIN must be a valid public origin.");
  }
  if (
    (checkoutOrigin.protocol !== "https:" &&
      !["localhost", "127.0.0.1", "[::1]"].includes(checkoutOrigin.hostname)) ||
    checkoutOrigin.username ||
    checkoutOrigin.password ||
    checkoutOrigin.pathname !== "/" ||
    checkoutOrigin.search ||
    checkoutOrigin.hash
  )
    throw new HttpError(
      503,
      "APP_ORIGIN must be a clean HTTPS origin (HTTP is allowed only for local development).",
    );
  const data = new URLSearchParams({
    mode: "payment",
    success_url: `${checkoutOrigin.origin}/payment-received.html?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${checkoutOrigin.origin}/payment-cancelled.html`,
    client_reference_id: order.id,
    "metadata[merchant_id]": order.merchant_id,
    "metadata[order_id]": order.id,
    "line_items[0][price_data][currency]": order.currency.toLowerCase(),
    "line_items[0][price_data][unit_amount]": String(
      Math.round(order.total * 100),
    ),
    "line_items[0][price_data][product_data][name]": `Ring Orden ${order.external_reference}`,
    "line_items[0][quantity]": "1",
  });
  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": `ring-${order.merchant_id}-${order.id}-${order.revision}`,
    },
    body: data,
    signal: AbortSignal.timeout(12000),
  });
  const result = (await response.json()) as {
    id: string;
    url: string;
    error?: { message?: string };
  };
  if (!response.ok || !result.url)
    throw new HttpError(
      502,
      result.error?.message ??
        "Stripe checkout could not be created. Your order is saved.",
    );
  return result;
}
export async function sendWhatsApp(
  order: Order,
  paymentUrl: string | undefined,
  env: RuntimeEnv,
): Promise<{ id: string; status: string }> {
  const authorization = twilioAuthorization(env);
  if (
    !env.TWILIO_ACCOUNT_SID ||
    !authorization ||
    !env.TWILIO_WHATSAPP_FROM
  )
    throw new HttpError(
      503,
      "Configure Twilio WhatsApp credentials and an approved sender.",
    );
  if (!order.customer?.phone)
    throw new HttpError(422, "A customer phone number is needed for WhatsApp.");
  const summary = order.items
    .map(
      (i) =>
        `${i.quantity} × ${i.name}${i.modifiers.length ? " (" + i.modifiers.map((m) => m.name).join(", ") + ")" : ""}`,
    )
    .join("\n");
  const params = new URLSearchParams({
    From: env.TWILIO_WHATSAPP_FROM.startsWith("whatsapp:")
      ? env.TWILIO_WHATSAPP_FROM
      : "whatsapp:" + env.TWILIO_WHATSAPP_FROM,
    To: "whatsapp:" + order.customer.phone,
  });
  if (env.TWILIO_WHATSAPP_TEMPLATE_SID) {
    params.set("ContentSid", env.TWILIO_WHATSAPP_TEMPLATE_SID);
    params.set(
      "ContentVariables",
      JSON.stringify({
        "1": order.external_reference,
        "2": summary,
        "3": `${order.total.toFixed(2)} ${order.currency}`,
        "4": paymentUrl ?? "Pay at pickup",
      }),
    );
  } else
    params.set(
      "Body",
      `${order.external_reference}\n${summary}\nTotal: ${order.total.toFixed(2)} ${order.currency}\nPickup at the counter.\n${paymentUrl ?? "Pay at pickup."}`,
    );
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID)}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: authorization,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params,
      signal: AbortSignal.timeout(10000),
    },
  );
  const result = (await response.json()) as {
    sid: string;
    status: string;
    message?: string;
  };
  if (!response.ok)
    throw new HttpError(
      502,
      result.message ?? "WhatsApp delivery failed. The order is saved.",
    );
  return { id: result.sid, status: result.status };
}
/** Invalidate the old amount before editing a confirmed-but-unpaid transaction. */
export async function expireCheckout(
  checkoutId: string,
  env: RuntimeEnv,
): Promise<void> {
  if (!env.STRIPE_SECRET_KEY)
    throw new HttpError(
      503,
      "Connect Stripe before changing an order with an active payment link.",
    );
  const response = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(checkoutId)}/expire`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
      signal: AbortSignal.timeout(10000),
    },
  );
  const result = (await response.json()) as { status?: string };
  if (!response.ok || result.status !== "expired")
    throw new HttpError(
      409,
      "The old payment link could not be closed. Check payment status before changing this order.",
    );
}
