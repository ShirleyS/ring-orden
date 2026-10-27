import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEMO_CATALOG,
  createOrder,
  applyOperation,
  applyOperations,
  transitionOrder,
  priceOrder,
  OperationSchema,
  OrderSchema,
} from "../src/index.ts";

const fresh = () => createOrder("merchant_a", "order_test");
const latte = () =>
  applyOperation(fresh(), {
    action: "add_item",
    catalog_item_id: "iced_latte",
    quantity: 2,
    modifier_ids: ["oat_milk"],
  });

test("catalog computes price from known products", () => {
  const order = latte();
  assert.equal(order.total, 180);
  assert.equal(order.items.length, 2);
  assert.equal(order.items[0].quantity, 1);
  assert.notEqual(order.items[0].line_id, order.items[1].line_id);
});

test("second latte can become regular without changing first", () => {
  const before = latte();
  const after = applyOperation(before, {
    action: "remove_modifier",
    target: { line_id: before.items[1].line_id },
    modifier_id: "oat_milk",
  });
  assert.equal(after.total, 168);
  assert.equal(after.items[0].modifiers[0].modifier_id, "oat_milk");
  assert.deepEqual(after.items[1].modifiers, []);
  assert.equal(before.total, 180);
});

test("an order requires explicit confirmation", () => {
  assert.throws(() =>
    applyOperation(latte(), { action: "confirm_order" } as never),
  );
  assert.equal(
    applyOperation(latte(), { action: "confirm_order", confirmed: true })
      .status,
    "CONFIRMED",
  );
});

test("empty orders cannot be confirmed", () =>
  assert.throws(() =>
    applyOperation(fresh(), { action: "confirm_order", confirmed: true }),
  ));

test("price is authoritative despite caller-invented totals", () => {
  const order = latte();
  order.items[0].unit_price = 0;
  order.items[0].modifiers[0].price_delta = -100;
  order.total = 0;
  assert.equal(priceOrder(order).total, 180);
});

test("target must exist", () =>
  assert.throws(() =>
    applyOperation(latte(), {
      action: "remove_item",
      target: { line_id: "someone_else" },
    }),
  ));
test("unknown products rejected", () =>
  assert.throws(() =>
    applyOperation(fresh(), {
      action: "add_item",
      catalog_item_id: "free_whiskey",
    }),
  ));
test("unknown modifier rejected", () =>
  assert.throws(() =>
    applyOperation(fresh(), {
      action: "add_item",
      catalog_item_id: "latte",
      modifier_ids: ["free"],
    }),
  ));
test("milk modifiers are mutually exclusive", () => {
  let order = latte();
  order = applyOperation(order, {
    action: "add_modifier",
    target: { line_id: order.items[0].line_id },
    modifier_id: "almond_milk",
  });
  assert.deepEqual(
    order.items[0].modifiers.map((m) => m.modifier_id),
    ["almond_milk"],
  );
});
test("modifier repeated does not double-charge", () => {
  const before = latte();
  const after = applyOperation(before, {
    action: "add_modifier",
    target: { line_id: before.items[0].line_id },
    modifier_id: "oat_milk",
  });
  assert.equal(after.total, before.total);
});
test("ambiguous clarification is persisted", () => {
  const order = applyOperation(latte(), {
    action: "request_clarification",
    question: "Which latte should get the extra shot?",
  });
  assert.equal(order.status, "AWAITING_CLARIFICATION");
  assert.equal(order.clarification, "Which latte should get the extra shot?");
});
test("operation clears resolved clarification", () => {
  const before = applyOperation(latte(), {
    action: "request_clarification",
    question: "Which one?",
  });
  const after = applyOperation(before, {
    action: "add_modifier",
    target: { line_id: before.items[0].line_id },
    modifier_id: "extra_shot",
  });
  assert.equal(after.clarification, null);
  assert.equal(after.status, "DRAFT");
});
test("confirmation is invalidated by an edit", () => {
  const before = applyOperation(latte(), {
    action: "confirm_order",
    confirmed: true,
  });
  const after = applyOperation(before, {
    action: "add_note",
    note: "Please add napkins",
  });
  assert.equal(after.status, "DRAFT");
});
test("paid orders cannot be edited by conversation", () => {
  let order = applyOperation(latte(), {
    action: "confirm_order",
    confirmed: true,
  });
  order = transitionOrder(order, "PAYMENT_PENDING");
  order = transitionOrder(order, "PAID");
  assert.equal(order.payment_status, "PAID");
  assert.throws(() =>
    applyOperation(order, {
      action: "remove_item",
      target: { line_id: order.items[0].line_id },
    }),
  );
});
test("paid cancellation requires refund flow", () => {
  let order = transitionOrder(
    applyOperation(latte(), { action: "confirm_order", confirmed: true }),
    "PAID",
  );
  assert.throws(() => applyOperation(order, { action: "cancel_order" }));
  order = transitionOrder(order, "REFUND_PENDING");
  assert.equal(order.payment_status, "REFUND_PENDING");
  order = transitionOrder(order, "REFUNDED");
  assert.equal(order.payment_status, "REFUNDED");
});
test("invalid state jumps fail", () =>
  assert.throws(() => transitionOrder(fresh(), "COMPLETED")));
test("successful batch is immutable", () => {
  const before = fresh();
  const after = applyOperations(before, [
    { action: "add_item", catalog_item_id: "latte" },
    { action: "set_customer_name", name: "Shirley" },
  ]);
  assert.equal(before.items.length, 0);
  assert.equal(after.customer.name, "Shirley");
  assert.equal(after.revision, 2);
});
test("failed batch leaves original state intact", () => {
  const before = fresh();
  assert.throws(() =>
    applyOperations(before, [
      { action: "add_item", catalog_item_id: "latte" },
      { action: "add_item", catalog_item_id: "missing" },
    ]),
  );
  assert.equal(before.items.length, 0);
});
test("customer name does not accept empty text", () =>
  assert.throws(() =>
    applyOperation(fresh(), { action: "set_customer_name", name: "  " }),
  ));
test("catalog availability checked again at confirmation", () => {
  const order = latte();
  const catalog = structuredClone(DEMO_CATALOG);
  catalog.find((i) => i.id === "iced_latte")!.available = false;
  assert.throws(() =>
    applyOperation(
      order,
      { action: "confirm_order", confirmed: true },
      catalog,
    ),
  );
});
test("modifier availability enforced", () => {
  const catalog = structuredClone(DEMO_CATALOG);
  catalog
    .find((i) => i.id === "latte")!
    .modifiers.find((m) => m.id === "oat_milk")!.available = false;
  assert.throws(() =>
    applyOperation(
      fresh(),
      {
        action: "add_item",
        catalog_item_id: "latte",
        modifier_ids: ["oat_milk"],
      },
      catalog,
    ),
  );
});
test("schema forbids authority fields in model operations", () => {
  assert.equal(
    OperationSchema.safeParse({
      action: "add_item",
      catalog_item_id: "latte",
      unit_price: 0,
    }).success,
    false,
  );
  assert.equal(
    OperationSchema.safeParse({ action: "set_payment_status", status: "PAID" })
      .success,
    false,
  );
  assert.equal(
    OperationSchema.safeParse({ action: "confirm_order", confirmed: false })
      .success,
    false,
  );
});
test("canonical order validates", () =>
  assert.equal(OrderSchema.safeParse(latte()).success, true));
test("line IDs remain unique after removal then insertion", () => {
  let order = latte();
  const removed = order.items[0].line_id;
  order = applyOperation(order, {
    action: "remove_item",
    target: { line_id: removed },
  });
  order = applyOperation(order, {
    action: "add_item",
    catalog_item_id: "latte",
  });
  assert.equal(
    new Set(order.items.map((i) => i.line_id)).size,
    order.items.length,
  );
  assert.notEqual(order.items.at(-1)!.line_id, removed);
});
test("change quantity expands stable unit lines", () => {
  let order = applyOperation(fresh(), {
    action: "add_item",
    catalog_item_id: "latte",
  });
  const first = order.items[0].line_id;
  order = applyOperation(order, {
    action: "change_quantity",
    target: { line_id: first },
    quantity: 3,
  });
  assert.equal(order.items.length, 3);
  assert.equal(order.total, 222);
  assert.equal(order.items[0].line_id, first);
});
for (const quantity of [0, -1, 1.5, 21, NaN, Infinity])
  test(`rejects unsafe quantity ${quantity}`, () =>
    assert.throws(() =>
      applyOperation(fresh(), {
        action: "add_item",
        catalog_item_id: "latte",
        quantity,
      }),
    ));
for (const quantity of [1, 2, 3, 5, 10, 20])
  for (const [id, price] of [
    ["americano", 60],
    ["latte", 74],
    ["iced_latte", 78],
    ["cappuccino", 72],
    ["croissant", 65],
    ["chocolate_croissant", 75],
    ["ube_croissant", 80],
  ] as const) {
    test(`${quantity} × ${id} prices deterministically`, () => {
      const order = applyOperation(fresh(), {
        action: "add_item",
        catalog_item_id: id,
        quantity,
      });
      assert.equal(order.total, quantity * price);
      assert.equal(order.items.length, quantity);
    });
  }
for (const id of ["americano", "latte", "iced_latte", "cappuccino"])
  for (const [modifier, delta] of [
    ["oat_milk", 12],
    ["almond_milk", 12],
    ["soy_milk", 10],
    ["decaf", 0],
    ["extra_shot", 15],
  ] as const) {
    test(`${id} + ${modifier} uses catalog delta`, () => {
      const item = DEMO_CATALOG.find((i) => i.id === id)!;
      const order = applyOperation(fresh(), {
        action: "add_item",
        catalog_item_id: id,
        modifier_ids: [modifier],
      });
      assert.equal(order.total, item.price + delta);
    });
  }
for (const item of [
  "americano",
  "latte",
  "iced_latte",
  "cappuccino",
  "croissant",
  "chocolate_croissant",
  "ube_croissant",
])
  test(`sold-out ${item} cannot be added`, () => {
    const catalog = structuredClone(DEMO_CATALOG);
    catalog.find((i) => i.id === item)!.available = false;
    assert.throws(() =>
      applyOperation(
        fresh(),
        { action: "add_item", catalog_item_id: item },
        catalog,
      ),
    );
  });
for (const status of [
  "PAID",
  "PREPARING",
  "READY",
  "COMPLETED",
  "REFUND_PENDING",
  "REFUNDED",
] as const)
  test(`draft cannot jump to ${status}`, () =>
    assert.throws(() => transitionOrder(fresh(), status)));
test("max total quantity rejects splitting around per-item limit", () => {
  let order = fresh();
  for (let i = 0; i < 2; i++)
    order = applyOperation(order, {
      action: "add_item",
      catalog_item_id: "latte",
      quantity: 20,
    });
  assert.throws(() =>
    applyOperation(order, {
      action: "add_item",
      catalog_item_id: "latte",
      quantity: 20,
    }),
  );
});
test("money rounds in minor units", () => {
  const catalog = structuredClone(DEMO_CATALOG);
  catalog[0].price = 0.1;
  catalog[0].modifiers[0].price_delta = 0.2;
  const order = applyOperation(
    fresh(),
    {
      action: "add_item",
      catalog_item_id: catalog[0].id,
      quantity: 3,
      modifier_ids: [catalog[0].modifiers[0].id],
    },
    catalog,
  );
  assert.equal(order.total, 0.9);
});
test("conflicting initial milk choices require clarification rather than silently choosing", () =>
  assert.throws(() =>
    applyOperation(fresh(), {
      action: "add_item",
      catalog_item_id: "latte",
      modifier_ids: ["oat_milk", "almond_milk"],
    }),
  ));
test("tax and fees are merchant policy, not previous state", () => {
  const order = latte();
  order.tax = 999;
  order.fees = 999;
  assert.equal(
    priceOrder(order, DEMO_CATALOG, { tax_rate: 0.16, fee_amount: 5 }).total,
    213.8,
  );
});
test("minimum order is enforced at confirmation", () =>
  assert.throws(() =>
    applyOperation(
      latte(),
      { action: "confirm_order", confirmed: true },
      DEMO_CATALOG,
      { minimum_order: 200 },
    ),
  ));
test("maximum value triggers human assistance", () =>
  assert.throws(() =>
    applyOperation(
      latte(),
      { action: "add_item", catalog_item_id: "latte" },
      DEMO_CATALOG,
      { maximum_order: 200 },
    ),
  ));
test("paid orders cannot be put back into draft via POS state", () => {
  let order = transitionOrder(
    applyOperation(latte(), { action: "confirm_order", confirmed: true }),
    "PAID",
  );
  order = transitionOrder(order, "POS_SYNC_PENDING");
  assert.throws(() => transitionOrder(order, "DRAFT"));
  assert.throws(() => transitionOrder(order, "CANCELLED"));
});
test("an ambiguous post-confirmation edit can request clarification before payment", () => {
  const before = transitionOrder(
    applyOperation(latte(), { action: "confirm_order", confirmed: true }),
    "PAYMENT_PENDING",
  );
  const after = applyOperation(before, {
    action: "request_clarification",
    question: "Which latte should get the extra shot?",
  });
  assert.equal(after.status, "AWAITING_CLARIFICATION");
  assert.equal(after.total, 180);
});
