import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SquareAdapter,
  CustomWebhookAdapter,
  PROVIDER_MANIFESTS,
} from "../src/index.ts";
import {
  createOrder,
  applyOperations,
} from "../../ring-orden-core/src/index.ts";
const order = applyOperations(createOrder("merchant_a", "order_123"), [
  {
    action: "add_item",
    catalog_item_id: "iced_latte",
    modifier_ids: ["oat_milk"],
  },
  { action: "confirm_order", confirmed: true },
]);
test("Square uses stable item and modifier mappings and integer prices", () => {
  const a = new SquareAdapter({
    accessToken: "secret",
    locationId: "loc",
    mappings: { iced_latte: "SQ_LATTE", oat_milk: "SQ_OAT" },
  });
  const payload = a.toPayload(order);
  assert.equal(payload.order.line_items[0].catalog_object_id, "SQ_LATTE");
  assert.equal(payload.order.line_items[0].base_price_money.amount, 7800);
  assert.equal(
    payload.order.line_items[0].modifiers[0].catalog_object_id,
    "SQ_OAT",
  );
  assert.equal(
    payload.order.line_items[0].modifiers[0].base_price_money.amount,
    1200,
  );
});
test("Square missing mapping fails instead of guessing by name", () => {
  const a = new SquareAdapter({
    accessToken: "secret",
    locationId: "loc",
    mappings: {},
  });
  assert.throws(() => a.toPayload(order), /mapping/);
});
test("Square retries reuse identical idempotency key", async () => {
  const bodies: any[] = [];
  const a = new SquareAdapter({
    accessToken: "secret",
    locationId: "loc",
    mappings: { iced_latte: "SQ_LATTE", oat_milk: "SQ_OAT" },
    fetch: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ order: { id: "sq_123" } }), {
        status: 200,
      });
    },
  });
  await a.createOrder(order);
  await a.createOrder(order);
  assert.equal(bodies[0].idempotency_key, bodies[1].idempotency_key);
});
test("Square error never claims successful sync", async () => {
  const a = new SquareAdapter({
    accessToken: "secret",
    locationId: "loc",
    mappings: { iced_latte: "SQ_LATTE", oat_milk: "SQ_OAT" },
    fetch: async () => new Response("{}", { status: 503 }),
  });
  await assert.rejects(() => a.createOrder(order), /503/);
});
test("webhook includes canonical order, signature and idempotency", async () => {
  let request: any;
  const a = new CustomWebhookAdapter({
    url: "https://example.com/orders",
    secret: "abc",
    fetch: async (_url, init) => {
      request = init;
      return new Response(JSON.stringify({ id: "ticket_1" }), { status: 200 });
    },
  });
  const result = await a.createOrder(order);
  assert.equal(result.external_order_id, "ticket_1");
  assert.equal(JSON.parse(request.body).order.merchant_id, "merchant_a");
  assert.ok(request.headers["X-Ring-Orden-Signature"]);
  assert.ok(request.headers["Idempotency-Key"]);
});
test("unverified providers advertise no write capability", () => {
  for (const provider of ["polotab", "parrot", "zettle"])
    assert.equal(PROVIDER_MANIFESTS[provider].order_create, false);
});
test("webhook rejects insecure endpoint", () =>
  assert.throws(
    () => new CustomWebhookAdapter({ url: "http://example.com" }),
    /HTTPS/,
  ));
test("Square refuses unsupported tax/fees instead of changing canonical total", () => {
  const a = new SquareAdapter({
    accessToken: "secret",
    locationId: "loc",
    mappings: { iced_latte: "SQ_LATTE", oat_milk: "SQ_OAT" },
  });
  assert.throws(
    () => a.toPayload({ ...order, tax: 10, total: order.total + 10 }),
    /tax|fees/i,
  );
});
for (const url of [
  "https://127.0.0.1",
  "https://10.0.0.1",
  "https://[::1]",
  "https://service.internal",
])
  test(`webhook rejects private destination ${url}`, () =>
    assert.throws(() => new CustomWebhookAdapter({ url }), /private|local/i));
