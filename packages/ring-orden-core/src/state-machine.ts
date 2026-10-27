import { OrderSchema, OrderStatusSchema } from "./schemas.ts";
import type { Order, OrderStatus } from "./schemas.ts";

export const STATE_TRANSITIONS: Readonly<
  Record<OrderStatus, readonly OrderStatus[]>
> = {
  DRAFT: [
    "AWAITING_CLARIFICATION",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "CANCELLED",
    "ESCALATED",
  ],
  AWAITING_CLARIFICATION: [
    "DRAFT",
    "AWAITING_CONFIRMATION",
    "CONFIRMED",
    "CANCELLED",
    "ESCALATED",
  ],
  AWAITING_CONFIRMATION: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "CONFIRMED",
    "CANCELLED",
    "ESCALATED",
  ],
  CONFIRMED: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "PAYMENT_PENDING",
    "PAID",
    "POS_SYNC_PENDING",
    "POS_SYNCED",
    "POS_SYNC_FAILED",
    "CANCELLED",
    "ESCALATED",
  ],
  PAYMENT_PENDING: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "PAID",
    "POS_SYNC_PENDING",
    "POS_SYNCED",
    "POS_SYNC_FAILED",
    "CANCELLED",
    "ESCALATED",
  ],
  PAID: [
    "POS_SYNC_PENDING",
    "POS_SYNCED",
    "POS_SYNC_FAILED",
    "PREPARING",
    "REFUND_PENDING",
    "ESCALATED",
  ],
  POS_SYNC_PENDING: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "POS_SYNCED",
    "POS_SYNC_FAILED",
    "PAYMENT_PENDING",
    "PAID",
    "CANCELLED",
    "REFUND_PENDING",
    "ESCALATED",
  ],
  POS_SYNCED: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "PAYMENT_PENDING",
    "PAID",
    "PREPARING",
    "CANCELLED",
    "REFUND_PENDING",
    "ESCALATED",
  ],
  POS_SYNC_FAILED: [
    "DRAFT",
    "AWAITING_CLARIFICATION",
    "POS_SYNC_PENDING",
    "POS_SYNCED",
    "PAYMENT_PENDING",
    "PAID",
    "CANCELLED",
    "REFUND_PENDING",
    "ESCALATED",
  ],
  PREPARING: ["READY", "REFUND_PENDING", "ESCALATED"],
  READY: ["COMPLETED", "REFUND_PENDING", "ESCALATED"],
  COMPLETED: ["REFUND_PENDING"],
  CANCELLED: [],
  REFUND_PENDING: ["REFUNDED", "ESCALATED"],
  REFUNDED: [],
  ESCALATED: ["DRAFT", "CANCELLED", "REFUND_PENDING", "PREPARING"],
};
/** Trusted application boundary. Never expose a generic status mutation to model or caller. */
export function transitionOrder(input: Order, status: OrderStatus): Order {
  const order = OrderSchema.parse(input);
  OrderStatusSchema.parse(status);
  if (order.status === status) return structuredClone(order);
  if (!STATE_TRANSITIONS[order.status].includes(status))
    throw new Error(`Invalid order transition: ${order.status} → ${status}`);
  if (
    (status === "CANCELLED" ||
      status === "DRAFT" ||
      status === "AWAITING_CLARIFICATION") &&
    order.payment_status === "PAID"
  )
    throw new Error(
      "Paid orders require merchant approval and a refund workflow",
    );
  if (
    [
      "CONFIRMED",
      "PAYMENT_PENDING",
      "PAID",
      "POS_SYNC_PENDING",
      "POS_SYNCED",
      "POS_SYNC_FAILED",
      "PREPARING",
      "READY",
      "COMPLETED",
    ].includes(status) &&
    order.items.length === 0
  )
    throw new Error("An empty order cannot enter a fulfillment state");
  if (
    ["PREPARING", "READY", "COMPLETED"].includes(status) &&
    order.payment_status !== "PAID"
  )
    throw new Error("Payment is required before preparation");
  const payment_status =
    status === "PAID"
      ? "PAID"
      : status === "REFUND_PENDING"
        ? "REFUND_PENDING"
        : status === "REFUNDED"
          ? "REFUNDED"
          : order.payment_status;
  return {
    ...order,
    status,
    payment_status,
    revision: order.revision + 1,
    updated_at: new Date().toISOString(),
  };
}
