import { z } from "zod";
import { configuredAgentSecret, HttpError } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { TenantState } from "./types.ts";
import { issueCustomerReceiptLink, customerOrigin } from "./customer-orders.ts";

const input = z
  .object({ conversation_id: z.string().trim().min(1).max(200) })
  .strict();
export type WidgetReceiptMessage = {
  id: string;
  text: string;
  link: { label: string; url: string };
};
export type WidgetReceiptResult =
  | { status: "READY"; message: WidgetReceiptMessage }
  | { status: "WAITING_SESSION" | "UNCONFIRMED" };
export type StoredWidgetReceipt = {
  hash: string;
  iv: string;
  ciphertext: string;
};
async function key(env: RuntimeEnv) {
  const secret = configuredAgentSecret(env);
  if (!secret || secret.length < 16)
    throw new HttpError(
      503,
      "Receipt delivery requires the configured agent service secret.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("ring-orden:widget-receipt:v1:" + secret),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
/** Only the authenticated merchant's exact conversation can issue a stub-phone receipt. */
export async function prepareWidgetReceipt(
  state: TenantState,
  body: unknown,
  env: RuntimeEnv,
): Promise<WidgetReceiptResult> {
  const { conversation_id } = input.parse(body);
  const sessions = state.sessions.filter(
    (s) => s.provider_conversation_id === conversation_id,
  );
  if (!sessions.length) return { status: "WAITING_SESSION" };
  if (sessions.length !== 1)
    throw new HttpError(409, "This conversation has multiple order bindings.");
  const order = state.orders.find(
    (o) => o.id === sessions[0].order_id && o.merchant_id === state.merchant.id,
  );
  if (!order) throw new HttpError(404, "The call order was not found.");
  if (
    ![
      "CONFIRMED",
      "PAYMENT_PENDING",
      "PAID",
      "POS_SYNC_PENDING",
      "POS_SYNCED",
      "POS_SYNC_FAILED",
      "PREPARING",
      "READY",
      "COMPLETED",
    ].includes(order.status) ||
    !order.items.length
  )
    return { status: "UNCONFIRMED" };
  const meta = state.order_metadata[order.id];
  if (
    ["PENDING", "PROCESSING"].includes(meta.delivery_status ?? "") ||
    meta.receipt_notification?.status === "PROCESSING"
  )
    return { status: "WAITING_SESSION" };
  const encryptionKey = await key(env);
  const additionalData = new TextEncoder().encode(
    state.merchant.id + ":" + order.id + ":" + conversation_id,
  );
  if (meta.widget_receipt) {
    if (
      meta.widget_receipt.hash !== meta.receipt_link?.hash ||
      Date.parse(meta.receipt_link.expires_at) <= Date.now()
    )
      throw new HttpError(
        410,
        "This receipt link expired or was revoked. Ask the owner for a new receipt.",
      );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decode(meta.widget_receipt.iv), additionalData },
      encryptionKey,
      decode(meta.widget_receipt.ciphertext),
    );
    const message = JSON.parse(
      new TextDecoder().decode(plain),
    ) as WidgetReceiptMessage;
    if (new URL(message.link.url).origin !== customerOrigin(env))
      throw new HttpError(
        409,
        "The customer receipt destination changed. Ask the owner for a new receipt.",
      );
    return { status: "READY", message };
  }
  const link = await issueCustomerReceiptLink(state, order, env);
  const lines = order.items
    .map(
      (i) =>
        `${i.quantity} × ${i.name}${i.modifiers.length ? " (" + i.modifiers.map((m) => m.name).join(", ") + ")" : ""}`,
    )
    .join("\n");
  const fulfillment = order.fulfillment.type === "delivery"
    ? `Entrega a domicilio: ${order.fulfillment.delivery_address}\nEnvío y cargos: ${order.fees.toFixed(2)} ${order.currency}`
    : order.fulfillment.type === "dine_in" ? "Para comer aquí" : "Para recoger";
  const text = `${state.merchant.name}\nPedido ${order.external_reference}\n${lines}\n${fulfillment}\nTotal: ${order.total.toFixed(2)} ${order.currency}\n${order.payment_status === "PAID" ? "Pagado" : "Pago pendiente"}\nVer pedido, recibo y datos de facturación`;
  const message: WidgetReceiptMessage = {
    id: "receipt-" + order.id,
    text: text.slice(0, 4000),
    link: { label: "Ver recibo", url: link.url },
  };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData },
    encryptionKey,
    new TextEncoder().encode(JSON.stringify(message)),
  );
  meta.widget_receipt = {
    hash: meta.receipt_link!.hash,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(encrypted)),
  };
  return { status: "READY", message };
}
