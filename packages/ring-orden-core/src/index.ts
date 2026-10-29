import { OperationSchema, OrderSchema } from "./schemas.ts";
import type {
  Order,
  OrderItem,
  CatalogItem,
  Operation,
  PricingRules,
} from "./schemas.ts";
import { DEMO_CATALOG } from "./catalog.ts";
import { priceOrder } from "./pricing.ts";
import { transitionOrder } from "./state-machine.ts";
export * from "./schemas.ts";
export { DEMO_CATALOG } from "./catalog.ts";
export { priceOrder } from "./pricing.ts";
export { transitionOrder, STATE_TRANSITIONS } from "./state-machine.ts";

export function createOrder(
  merchantId: string,
  id: string = `order_${crypto.randomUUID()}`,
): Order {
  const now = new Date().toISOString();
  return OrderSchema.parse({
    id,
    merchant_id: merchantId,
    external_reference: `RO-${id
      .replace(/^order_/, "")
      .slice(-8)
      .toUpperCase()}`,
    source: "voice",
    currency: "MXN",
    customer: { name: null, phone: null },
    fulfillment: { type: "pickup", scheduled_for: null },
    items: [],
    subtotal: 0,
    tax: 0,
    fees: 0,
    total: 0,
    status: "DRAFT",
    payment_status: "PENDING",
    notes: [],
    clarification: null,
    revision: 0,
    created_at: now,
    updated_at: now,
  });
}
const editable = new Set<Order["status"]>([
  "DRAFT",
  "AWAITING_CLARIFICATION",
  "AWAITING_CONFIRMATION",
  "CONFIRMED",
  "PAYMENT_PENDING",
  "POS_SYNC_PENDING",
  "POS_SYNCED",
  "POS_SYNC_FAILED",
]);
function nextLineId(): string {
  return `line_${crypto.randomUUID()}`;
}
function catalogItem(catalog: CatalogItem[], id: string): CatalogItem {
  const item = catalog.find((i) => i.id === id);
  if (!item) throw new Error(`Unknown product: ${id}`);
  if (!item.available) throw new Error(`${item.name} is currently unavailable`);
  return item;
}
function modifiersFor(
  catalog: CatalogItem[],
  itemId: string,
  ids: string[],
): OrderItem["modifiers"] {
  const item = catalogItem(catalog, itemId);
  const result: OrderItem["modifiers"] = [];
  for (const id of [...new Set(ids)]) {
    const modifier = item.modifiers.find((m) => m.id === id);
    if (!modifier)
      throw new Error(`Modifier ${id} is not valid for ${item.name}`);
    if (!modifier.available)
      throw new Error(`${modifier.name} is currently unavailable`);
    if (modifier.group) {
      const conflict = result.findIndex(
        (m) =>
          item.modifiers.find((v) => v.id === m.modifier_id)?.group ===
          modifier.group,
      );
      if (conflict >= 0)
        throw new Error(`Choose only one ${modifier.group} option`);
    }
    result.push({
      modifier_id: modifier.id,
      name: modifier.name,
      price_delta: modifier.price_delta,
    });
  }
  return result;
}
function lineFor(order: Order, lineId: string): OrderItem {
  const line = order.items.find((i) => i.line_id === lineId);
  if (!line) throw new Error(`Unknown order line: ${lineId}`);
  return line;
}
function expandQuantity(order: Order, line: OrderItem, quantity: number) {
  line.quantity = 1;
  const position = order.items.findIndex((i) => i.line_id === line.line_id);
  const extra = Array.from({ length: quantity - 1 }, () => ({
    ...structuredClone(line),
    line_id: nextLineId(),
  }));
  order.items.splice(position + 1, 0, ...extra);
}
/** Apply only schema-validated operations. Catalog prices always replace model-supplied money. */
export function applyOperation(
  input: Order,
  proposal: Operation,
  catalog: CatalogItem[] = DEMO_CATALOG,
  rules: PricingRules = {},
): Order {
  const operation = OperationSchema.parse(proposal);
  let order = structuredClone(OrderSchema.parse(input));
  if (
    !editable.has(order.status) ||
    order.payment_status === "PAID" ||
    order.payment_status === "REFUNDED" ||
    order.payment_status === "REFUND_PENDING"
  ) {
    throw new Error(
      "This order requires merchant assistance before it can be changed",
    );
  }
  if (operation.action === "cancel_order")
    return transitionOrder(order, "CANCELLED");
  if (operation.action === "escalate_issue")
    return {
      ...transitionOrder(order, "ESCALATED"),
      notes: [...order.notes, operation.reason],
      clarification: null,
    };
  if (operation.action === "request_clarification")
    return {
      ...transitionOrder(order, "AWAITING_CLARIFICATION"),
      clarification: operation.question,
    };
  if (operation.action === "confirm_order") {
    // Retrying consent must preserve the accepted quote and fulfillment progress.
    if (
      [
        "CONFIRMED",
        "PAYMENT_PENDING",
        "POS_SYNC_PENDING",
        "POS_SYNCED",
        "POS_SYNC_FAILED",
      ].includes(order.status)
    )
      return order;
    if (order.status === "AWAITING_CLARIFICATION" && order.clarification)
      throw new Error("Resolve the clarification before confirming");
    if (order.fulfillment.type === "delivery" && !order.fulfillment.delivery_address?.trim())
      throw new Error("A delivery address is required before confirming.");
    order = priceOrder(order, catalog, rules);
    if (!order.items.length)
      throw new Error("Add at least one item before confirming");
    if (order.total < (rules.minimum_order ?? 0))
      throw new Error("This order does not meet the minimum order amount");
    return { ...transitionOrder(order, "CONFIRMED"), clarification: null };
  }
  if (operation.action === "add_item") {
    const item = catalogItem(catalog, operation.catalog_item_id);
    const modifiers = modifiersFor(
      catalog,
      item.id,
      operation.modifier_ids ?? [],
    );
    const quantity = operation.quantity ?? 1;
    for (let i = 0; i < quantity; i++)
      order.items.push({
        line_id: nextLineId(),
        catalog_item_id: item.id,
        name: item.name,
        quantity: 1,
        unit_price: item.price,
        modifiers: structuredClone(modifiers),
      });
  } else if (operation.action === "remove_item") {
    lineFor(order, operation.target.line_id);
    order.items = order.items.filter(
      (i) => i.line_id !== operation.target.line_id,
    );
  } else if (operation.action === "modify_item") {
    const line = lineFor(order, operation.target.line_id);
    const { changes } = operation;
    if (changes.catalog_item_id) {
      const item = catalogItem(catalog, changes.catalog_item_id);
      line.catalog_item_id = item.id;
      line.name = item.name;
      line.unit_price = item.price;
      line.modifiers = modifiersFor(
        catalog,
        item.id,
        changes.modifier_ids ?? [],
      );
    } else if (changes.modifier_ids)
      line.modifiers = modifiersFor(
        catalog,
        line.catalog_item_id,
        changes.modifier_ids,
      );
    if (changes.quantity !== undefined)
      expandQuantity(order, line, changes.quantity);
  } else if (operation.action === "change_quantity") {
    expandQuantity(
      order,
      lineFor(order, operation.target.line_id),
      operation.quantity,
    );
  } else if (operation.action === "add_modifier") {
    const line = lineFor(order, operation.target.line_id);
    const item = catalogItem(catalog, line.catalog_item_id);
    const incoming = item.modifiers.find((m) => m.id === operation.modifier_id);
    const retained = line.modifiers
      .filter(
        (m) =>
          !incoming?.group ||
          item.modifiers.find((v) => v.id === m.modifier_id)?.group !==
            incoming.group,
      )
      .map((m) => m.modifier_id);
    line.modifiers = modifiersFor(catalog, line.catalog_item_id, [
      ...retained,
      operation.modifier_id,
    ]);
  } else if (operation.action === "remove_modifier") {
    const line = lineFor(order, operation.target.line_id);
    const item = catalogItem(catalog, line.catalog_item_id);
    if (!item.modifiers.some((m) => m.id === operation.modifier_id))
      throw new Error("Unknown modifier for this item");
    line.modifiers = line.modifiers.filter(
      (m) => m.modifier_id !== operation.modifier_id,
    );
  } else if (operation.action === "set_customer_name")
    order.customer.name = operation.name;
  else if (operation.action === "set_fulfillment") {
    order.fulfillment.type = operation.fulfillment_type;
    if (operation.fulfillment_type !== "delivery") delete order.fulfillment.delivery_address;
    else if (operation.delivery_address) order.fulfillment.delivery_address = operation.delivery_address;
  }
  else if (operation.action === "set_pickup_time")
    order.fulfillment.scheduled_for = operation.scheduled_for;
  else if (operation.action === "add_note") order.notes.push(operation.note);
  order = {
    ...order,
    status: "DRAFT",
    clarification: null,
    revision: order.revision + 1,
    updated_at: new Date().toISOString(),
  };
  return priceOrder(order, catalog, rules);
}
export function applyOperations(
  order: Order,
  operations: Operation[],
  catalog: CatalogItem[] = DEMO_CATALOG,
  rules: PricingRules = {},
): Order {
  if (!Array.isArray(operations) || operations.length > 50)
    throw new Error("A turn may contain at most 50 operations");
  return operations.reduce(
    (state, operation) => applyOperation(state, operation, catalog, rules),
    structuredClone(order),
  );
}
