import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";

async function fixture() {
  const repo = new MemoryRepository();
  const env = {
    TRUST_SITES_HEADERS: "true",
    DEMO_MODE: "false",
    AGENT_TOOL_SECRET: "structured-test-secret",
    AGENT_MERCHANT_ID: "",
  };
  const call = async (path: string, body?: unknown, agent = true) => {
    const response = await handleRequest(
      new Request(`https://ring.test/api/${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          ...(agent
            ? { Authorization: "Bearer structured-test-secret" }
            : { "oai-authenticated-user-id": "structured-owner" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  const boot = await call("bootstrap", undefined, false);
  env.AGENT_MERCHANT_ID = boot.data.merchant.id;
  const stored = await repo.loadByMerchant(env.AGENT_MERCHANT_ID);
  assert.ok(stored);
  stored.state.settings.agent.after_hours = "accept_orders";
  await repo.saveTrusted(env.AGENT_MERCHANT_ID, stored.revision, stored.state);
  const session = await call("tools/create_session", {
    request_id: crypto.randomUUID(),
  });
  assert.equal(session.status, 201, JSON.stringify(session.data));
  return {
    call,
    session_id: session.data.session_id,
    catalog: stored.state.catalog,
  };
}

test("structured live ordering needs no second LLM key and keeps canonical pricing and idempotency", async () => {
  const f = await fixture();
  const item = f.catalog.find((i) => i.available)!;
  const body = {
    session_id: f.session_id,
    request_id: "add-once",
    utterance: "Uno, por favor",
    operations_json: JSON.stringify([
      { action: "add_item", catalog_item_id: item.id, quantity: 1 },
    ]),
  };
  const first = await f.call("tools/apply_order_operations", body);
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.order.items.length, 1);
  assert.equal(first.data.order.items[0].unit_price, item.price);
  assert.notEqual(first.data.order.status, "CONFIRMED");
  assert.deepEqual(await f.call("tools/apply_order_operations", body), first);
  const forged = await f.call("tools/apply_order_operations", {
    ...body,
    request_id: "forged",
    operations_json: JSON.stringify([
      { action: "add_item", catalog_item_id: item.id, unit_price: 0 },
    ]),
  });
  assert.equal(forged.status, 422);
  const hiddenConfirmation = await f.call("tools/apply_order_operations", {
    ...body,
    request_id: "hidden-confirmation",
    operations_json: '[{"action":"confirm_order","confirmed":true}]',
  });
  assert.equal(hiddenConfirmation.status, 422);
  const refused = await f.call("tools/confirm_order", {
    session_id: f.session_id,
    request_id: "refused",
    confirmed: true,
    utterance: "No, no confirmes",
  });
  assert.equal(refused.status, 422);
  const confirmed = await f.call("tools/confirm_order", {
    session_id: f.session_id,
    request_id: "confirmed",
    confirmed: true,
    utterance: "Sí, confirmo mi pedido",
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.ok(
    ["CONFIRMED", "PAYMENT_PENDING", "POS_SYNC_PENDING"].includes(
      confirmed.data.order.status,
    ),
  );
});

test("structured order input rejects malformed JSON and unknown catalog items without changing the draft", async () => {
  const f = await fixture();
  const body = {
    session_id: f.session_id,
    request_id: "bad-json",
    utterance: "Un latte",
    operations_json: "not json",
  };
  assert.equal(
    (await f.call("tools/apply_order_operations", body)).status,
    422,
  );
  const unknown = await f.call("tools/apply_order_operations", {
    ...body,
    request_id: "bad-item",
    operations_json:
      '[{"action":"add_item","catalog_item_id":"does-not-exist"}]',
  });
  assert.equal(unknown.status, 400);
  const state = await f.call("tools/get_order_state", {
    session_id: f.session_id,
  });
  assert.equal(state.data.items.length, 0);
});
