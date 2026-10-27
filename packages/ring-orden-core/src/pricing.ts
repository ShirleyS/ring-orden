import { CatalogItemSchema, OrderSchema } from "./schemas.ts";
import type { Order, CatalogItem, PricingRules } from "./schemas.ts";
import { DEMO_CATALOG } from "./catalog.ts";
const cents = (amount: number) => Math.round(amount * 100);
export function priceOrder(
  input: Order,
  catalog: CatalogItem[] = DEMO_CATALOG,
  rules: PricingRules = {},
): Order {
  const order = OrderSchema.parse({
    ...input,
    subtotal: 0,
    tax: 0,
    fees: 0,
    total: 0,
    items: input.items.map((line) => ({
      ...line,
      unit_price: 0,
      modifiers: line.modifiers.map((modifier) => ({
        ...modifier,
        price_delta: 0,
      })),
    })),
  });
  const parsed = catalog.map((i) => CatalogItemSchema.parse(i));
  if (new Set(parsed.map((i) => i.id)).size !== parsed.length)
    throw new Error("Duplicate catalog IDs");
  if (new Set(order.items.map((i) => i.line_id)).size !== order.items.length)
    throw new Error("Duplicate order line IDs");
  const items = order.items.map((line) => {
    const item = parsed.find((i) => i.id === line.catalog_item_id);
    if (!item) throw new Error(`Unknown product: ${line.catalog_item_id}`);
    if (!item.available)
      throw new Error(`${item.name} is currently unavailable`);
    const seen = new Set<string>();
    const groups = new Set<string>();
    const modifiers = line.modifiers.map((m) => {
      if (seen.has(m.modifier_id)) throw new Error("Duplicate modifier");
      seen.add(m.modifier_id);
      const modifier = item.modifiers.find((v) => v.id === m.modifier_id);
      if (!modifier)
        throw new Error(
          `Modifier ${m.modifier_id} is not valid for ${item.name}`,
        );
      if (!modifier.available)
        throw new Error(`${modifier.name} is currently unavailable`);
      if (modifier.group && groups.has(modifier.group))
        throw new Error(`Choose only one ${modifier.group} option`);
      if (modifier.group) groups.add(modifier.group);
      return {
        modifier_id: modifier.id,
        name: modifier.name,
        price_delta: cents(modifier.price_delta) / 100,
      };
    });
    return {
      ...line,
      name: item.name,
      unit_price: cents(item.price) / 100,
      modifiers,
    };
  });
  const maximumQuantity = rules.maximum_quantity ?? 50;
  if (
    !Number.isInteger(maximumQuantity) ||
    maximumQuantity < 1 ||
    maximumQuantity > 1000
  )
    throw new Error("Invalid maximum quantity policy");
  if (items.reduce((sum, i) => sum + i.quantity, 0) > maximumQuantity)
    throw new Error(
      `Orders are limited to ${maximumQuantity} items; please request a person for a larger order`,
    );
  const subtotalCents = items.reduce(
    (sum, i) =>
      sum +
      i.quantity *
        (cents(i.unit_price) +
          i.modifiers.reduce((n, m) => n + cents(m.price_delta), 0)),
    0,
  );
  const taxRate = rules.tax_rate ?? 0;
  const fee = rules.fee_amount ?? 0;
  const maximum = rules.maximum_order ?? 5000;
  if (
    !Number.isFinite(taxRate) ||
    taxRate < 0 ||
    taxRate > 1 ||
    !Number.isFinite(fee) ||
    fee < 0 ||
    !Number.isFinite(maximum) ||
    maximum <= 0
  )
    throw new Error("Invalid pricing policy");
  const taxCents = Math.round(subtotalCents * taxRate);
  const feeCents = items.length ? cents(fee) : 0;
  const totalCents = subtotalCents + taxCents + feeCents;
  if (totalCents > cents(maximum))
    throw new Error(
      `Orders over ${maximum} ${order.currency} require a person`,
    );
  return {
    ...order,
    items,
    subtotal: subtotalCents / 100,
    tax: taxCents / 100,
    fees: feeCents / 100,
    total: totalCents / 100,
  };
}
