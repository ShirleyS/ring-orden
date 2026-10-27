# Ring Orden Core

MIT-licensed deterministic transaction boundary for voice commerce. The language model proposes operations; this package validates and applies them. It never calls a model, writes a database, or accepts a model-supplied price.

## Run independently

Copy this directory, install its dependencies with `npm install`, and run `npm test`. Node 22.13 or later is required for native TypeScript stripping. `npm run example` prints a confirmed two-latte transaction totaling **183 MXN**. The source is also importable by TypeScript bundlers.

```ts
import { createOrder, applyOperation, OperationSchema } from '@ring-orden/core';
const proposal = OperationSchema.parse({
  action: 'add_item', catalog_item_id: 'latte', quantity: 2,
  modifier_ids: ['oat_milk'],
});
const order = applyOperation(createOrder('merchant_123'), proposal);
// order.items has two stable, separately addressable lines; total = 172 MXN
```

## Public interface

- `createOrder(merchantId, id?)` creates a canonical DRAFT transaction.
- `applyOperation(order, proposal, catalog?, rules?)` validates the strict operation schema, catalog and business policy and returns a new state.
- `applyOperations(order, proposals, catalog?, rules?)` applies an atomic immutable batch: the original order remains unchanged if any operation fails.
- `priceOrder(order, catalog?, rules?)` replaces every price and modifier delta from the authoritative catalog, calculating in integer minor units.
- `transitionOrder(order, status)` is a **trusted application-only** payment/fulfillment boundary. Never expose it as an unrestricted HTTP or model tool. Verified provider events, authenticated merchant actions and explicit demo simulations are its callers.
- Zod schemas: `OrderSchema`, `OrderItemSchema`, `OperationSchema`, `CatalogItemSchema`, `ModifierSchema`, `OrderStatusSchema`.
- Types: `Order`, `OrderItem`, `Operation`, `CatalogItem`, `Modifier`, `OrderStatus`, `PricingRules`.
- `DEMO_CATALOG` contains the seven reference menu items and their stable modifier IDs.
- `STATE_TRANSITIONS` documents every permitted state transition.

## Safety and semantics

Currency display values are decimal MXN, but pricing rounds each catalog amount to minor units before sums. No model operation may specify `price`, `total`, payment status, merchant ID, or credentials. Unknown fields are rejected. Defaults limit transactions to 50 total units, 20 units per individual add operation, and 5,000 MXN. Authenticated application policy may supply `maximum_quantity`, `maximum_order`, `minimum_order`, `tax_rate` and `fee_amount`; callers must never control that argument.

Adding quantity 2 produces two unit lines so “the first” and “the second” have stable targets. `change_quantity` changes the addressed line into the requested number of unit lines, preserving the original line ID and assigning new IDs to additional units. It does not silently modify other existing lines. The interpretation layer must expand plural references into explicit operations.

`add_modifier` replaces another modifier in the same exclusive group. Supplying conflicting initial modifiers requires clarification and fails validation. Adding an existing modifier is idempotent. Catalog availability is enforced during every price calculation, including final confirmation.

Confirmation requires `{action:'confirm_order',confirmed:true}`, a nonempty order and no unresolved clarification. Editing a confirmed but unpaid order returns it to DRAFT, so the application must invalidate any old checkout and request confirmation again. Conversation operations cannot modify PAID, PREPARING or later orders. Paid cancellation requires the explicit refund lifecycle; REFUNDED is permitted only after a trusted provider confirmation.

The package does not enforce authentication, tenant membership, opening hours or persistence concurrency. Those belong at the server boundary before applying an operation. Merchant IDs are immutable within operations. The server must serialize changes to each order, use revision checks, and gate trusted transitions on verified provider events.

## Tests

The automated suite covers authoritative pricing, money precision, every demo product and modifier, catalog availability, quantity and value limits, immutable batch failure, reference-target isolation, explicit confirmation, schema rejection of authority fields, state transitions and refund boundaries. Language interpretation is tested in OpenModel Gateway, not by this deterministic package. No external credentials or customer data are needed.
