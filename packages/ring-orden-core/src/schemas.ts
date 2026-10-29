import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const money = z.number().finite().nonnegative().max(1_000_000);
const quantity = z.number().int().min(1).max(20);
const target = z.object({ line_id: id }).strict();
const text = z.string().trim().min(1).max(1000);
export const OrderStatusSchema = z.enum([
  "DRAFT",
  "AWAITING_CLARIFICATION",
  "AWAITING_CONFIRMATION",
  "CONFIRMED",
  "PAYMENT_PENDING",
  "PAID",
  "POS_SYNC_PENDING",
  "POS_SYNCED",
  "POS_SYNC_FAILED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "CANCELLED",
  "REFUND_PENDING",
  "REFUNDED",
  "ESCALATED",
]);
export const ModifierSchema = z
  .object({
    id,
    name: text,
    price_delta: money,
    available: z.boolean(),
    group: z.string().optional(),
  })
  .strict();
export const CatalogItemSchema = z
  .object({
    id,
    name: text,
    description: z.string().max(2000).optional(),
    price: money,
    category: text,
    available: z.boolean(),
    modifiers: z.array(ModifierSchema).max(50),
  })
  .strict();
export const OrderItemSchema = z
  .object({
    line_id: id,
    catalog_item_id: id,
    name: text,
    quantity: z.number().int().min(1).max(20),
    unit_price: money,
    modifiers: z
      .array(
        z.object({ modifier_id: id, name: text, price_delta: money }).strict(),
      )
      .max(50),
  })
  .strict();
export const OrderSchema = z.object({
  id,
  merchant_id: id,
  external_reference: id,
  source: z.enum(["voice", "dashboard", "demo"]),
  currency: z.string().length(3),
  customer: z
    .object({
      name: z.string().max(120).nullable(),
      phone: z.string().max(40).nullable(),
    })
    .strict(),
  fulfillment: z
    .object({
      type: z.enum(["pickup", "dine_in", "delivery"]),
      scheduled_for: z.string().datetime({ offset: true }).nullable(),
      delivery_address: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  items: z.array(OrderItemSchema).max(50),
  subtotal: money,
  tax: money,
  fees: money,
  total: money,
  status: OrderStatusSchema,
  payment_status: z.enum([
    "PENDING",
    "PAID",
    "PAYMENT_ERROR",
    "REFUND_PENDING",
    "REFUNDED",
  ]),
  notes: z.array(z.string().max(1000)).max(30),
  clarification: z.string().max(1000).nullable().optional(),
  revision: z.number().int().nonnegative(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export const OperationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("add_item"),
      catalog_item_id: id,
      quantity: quantity.optional(),
      modifier_ids: z.array(id).max(50).optional(),
    })
    .strict(),
  z.object({ action: z.literal("remove_item"), target }).strict(),
  z
    .object({
      action: z.literal("modify_item"),
      target,
      changes: z
        .object({
          catalog_item_id: id.optional(),
          modifier_ids: z.array(id).max(50).optional(),
          quantity: quantity.optional(),
        })
        .strict()
        .refine(
          (v) => Object.keys(v).length > 0,
          "At least one change is required",
        ),
    })
    .strict(),
  z.object({ action: z.literal("change_quantity"), target, quantity }).strict(),
  z
    .object({ action: z.literal("add_modifier"), target, modifier_id: id })
    .strict(),
  z
    .object({ action: z.literal("remove_modifier"), target, modifier_id: id })
    .strict(),
  z
    .object({
      action: z.literal("set_customer_name"),
      name: z.string().trim().min(1).max(120),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_fulfillment"),
      fulfillment_type: z.enum(["pickup", "dine_in", "delivery"]),
      delivery_address: z.string().trim().min(1).max(500).optional(),
    })
    .strict(),
  z
    .object({
      action: z.literal("set_pickup_time"),
      scheduled_for: z.string().datetime({ offset: true }).nullable(),
    })
    .strict(),
  z.object({ action: z.literal("add_note"), note: text }).strict(),
  z
    .object({ action: z.literal("confirm_order"), confirmed: z.literal(true) })
    .strict(),
  z.object({ action: z.literal("cancel_order") }).strict(),
  z
    .object({ action: z.literal("request_clarification"), question: text })
    .strict(),
  z.object({ action: z.literal("escalate_issue"), reason: text }).strict(),
]);
export type Order = z.infer<typeof OrderSchema>;
export type OrderItem = z.infer<typeof OrderItemSchema>;
export type OrderStatus = z.infer<typeof OrderStatusSchema>;
export type CatalogItem = z.infer<typeof CatalogItemSchema>;
export type Modifier = z.infer<typeof ModifierSchema>;
export type Operation = z.infer<typeof OperationSchema>;
export interface PricingRules {
  tax_rate?: number;
  fee_amount?: number;
  delivery_fee?: number;
  minimum_order?: number;
  maximum_order?: number;
  maximum_quantity?: number;
}
