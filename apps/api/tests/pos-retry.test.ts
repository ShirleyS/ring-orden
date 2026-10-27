import test from "node:test";
import assert from "node:assert/strict";
import { retryDuePOS } from "../src/pos-retry.ts";
import { MemoryRepository } from "../src/repository.ts";
import { seedTenant } from "../src/seed.ts";
async function fixture() {
  const repo = new MemoryRepository();
  const state = seedTenant("merchant-retry", {
    id: "owner",
    name: "Owner",
    email: "owner@example.com",
    provider: "sites",
  });
  const order = state.orders.find(
    (o) => state.order_metadata[o.id].pos_status === "FAILED",
  )!;
  state.order_metadata[order.id].pos_attempts = 1;
  state.settings.pos.retry_limit = 3;
  await repo.create(state.merchant.id, "owner", state);
  return { repo, id: state.merchant.id, orderId: order.id };
}
test("automatic retry claims one due order durably before provider and skips concurrent runner", async () => {
  const { repo, id, orderId } = await fixture();
  let calls = 0;
  const sync = async (state: any, order: any) => {
    calls++;
    const saved = await repo.loadByMerchant(id);
    assert.equal(saved!.state.order_metadata[orderId].pos_status, "RETRYING");
    assert.ok(saved!.state.order_metadata[orderId].pos_retry_claim);
    state.order_metadata[order.id].pos_status = "SYNCED";
    state.order_metadata[order.id].pos_attempts++;
    return order;
  };
  await Promise.all([retryDuePOS(repo, id, sync), retryDuePOS(repo, id, sync)]);
  assert.equal(calls, 1);
  const final = await repo.loadByMerchant(id);
  assert.equal(final!.state.order_metadata[orderId].pos_status, "SYNCED");
});
test("retry honors next due time and maximum total attempts", async () => {
  const { repo, id, orderId } = await fixture();
  let stored = (await repo.loadByMerchant(id))!;
  stored.state.order_metadata[orderId].pos_next_retry_at = new Date(
    Date.now() + 60000,
  ).toISOString();
  await repo.saveTrusted(id, stored.revision, stored.state);
  let calls = 0;
  const sync = async (_state: any, order: any) => {
    calls++;
    return order;
  };
  assert.deepEqual((await retryDuePOS(repo, id, sync)).results, []);
  assert.equal(calls, 0);
  stored = (await repo.loadByMerchant(id))!;
  stored.state.order_metadata[orderId].pos_next_retry_at = null;
  stored.state.order_metadata[orderId].pos_attempts = 3;
  await repo.saveTrusted(id, stored.revision, stored.state);
  assert.deepEqual((await retryDuePOS(repo, id, sync)).results, []);
  assert.equal(calls, 0);
});
test("stale retry lease can recover with provider idempotency retained", async () => {
  const { repo, id, orderId } = await fixture();
  const stored = (await repo.loadByMerchant(id))!;
  stored.state.order_metadata[orderId].pos_status = "RETRYING";
  stored.state.order_metadata[orderId].pos_retry_claim = "stale";
  stored.state.order_metadata[orderId].pos_retry_claimed_at = new Date(
    Date.now() - 180000,
  ).toISOString();
  await repo.saveTrusted(id, stored.revision, stored.state);
  let called = false;
  await retryDuePOS(repo, id, async (state, order) => {
    called = true;
    assert.equal(order.id, orderId);
    state.order_metadata[order.id].pos_status = "SYNCED";
    return order;
  });
  assert.equal(called, true);
});
