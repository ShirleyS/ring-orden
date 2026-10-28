import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";

async function fixture() {
  const repo = new MemoryRepository();
  const origin = "https://customer.example";
  const call = async (
    path: string,
    method = "GET",
    body?: unknown,
    agent = false,
    extra: Record<string, string> = {},
  ) => {
    const response = await handleRequest(
      new Request(`https://ring.test/api/${path}`, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...(agent
            ? { Authorization: "Bearer test-integration-secret" }
            : { "oai-authenticated-user-id": "integration-owner" }),
          ...extra,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  const env = {
    TRUST_SITES_HEADERS: "true",
    AGENT_TOOL_SECRET: "test-integration-secret",
    AGENT_MERCHANT_ID: "",
    CUSTOMER_APP_ORIGIN: origin,
  };
  const workspace = await call("bootstrap");
  env.AGENT_MERCHANT_ID = workspace.data.merchant.id;
  const session = await call(
    "tools/create_session",
    "POST",
    { request_id: "first", phone: "+52 (55) 5555-0123", name: "Ana" },
    true,
  );
  return { repo, env, call, session, origin };
}

test("new sessions start in Spanish and customer recognition survives another conversation", async () => {
  const f = await fixture();
  assert.equal(f.session.status, 201, JSON.stringify(f.session.data));
  assert.match(f.session.data.turns[0].text, /^¡Hola!/);
  assert.deepEqual(f.session.data.language_policy.supported, [
    "es-MX",
    "en-US",
    "zh-CN",
  ]);
  const first = await f.call(
    "tools/get_customer_context",
    "POST",
    { session_id: f.session.data.session_id },
    true,
  );
  const second = await f.call(
    "tools/create_session",
    "POST",
    { request_id: "second", phone: "+525555550123" },
    true,
  );
  assert.equal(second.status, 201);
  assert.equal(
    second.data.customer_context.customer_id,
    first.data.customer_id,
  );
  assert.equal(second.data.customer_context.verified, false);
  assert.equal(second.data.customer_context.display_name, "Ana");
  const history = await f.call(
    "tools/get_previous_orders",
    "POST",
    { session_id: second.data.session_id, verified: true },
    true,
  );
  assert.equal(history.status, 403);
});

test("a recognized caller starts empty and confirms a name without copying a previous order", async () => {
  const f = await fixture();
  const stored = await f.repo.loadByMerchant(f.env.AGENT_MERCHANT_ID);
  assert.ok(stored);
  stored.state.settings.agent.after_hours = "accept_orders";
  const item = stored.state.catalog.find((entry) => entry.available)!;
  assert.ok(item);
  assert.equal(
    await f.repo.saveTrusted(
      f.env.AGENT_MERCHANT_ID,
      stored.revision,
      stored.state,
    ),
    true,
  );
  const added = await f.call(
    "tools/apply_order_operations",
    "POST",
    {
      session_id: f.session.data.session_id,
      request_id: "original-items",
      utterance: "Uno, por favor",
      operations_json: JSON.stringify([
        { action: "add_item", catalog_item_id: item.id, quantity: 1 },
      ]),
    },
    true,
  );
  assert.equal(added.status, 200, JSON.stringify(added.data));
  const original = await f.repo.loadByMerchant(f.env.AGENT_MERCHANT_ID);
  assert.ok(original);
  const previous = original.state.orders.find(
    (order) => order.id === f.session.data.order_id,
  )!;
  assert.equal(previous.items.length, 1);
  previous.status = "COMPLETED";
  previous.payment_status = "PAID";
  assert.equal(
    await f.repo.saveTrusted(
      f.env.AGENT_MERCHANT_ID,
      original.revision,
      original.state,
    ),
    true,
  );

  const fresh = await f.call(
    "tools/create_session",
    "POST",
    {
      request_id: "new-call-empty",
      phone: "+525555550123",
    },
    true,
  );
  assert.equal(fresh.status, 201, JSON.stringify(fresh.data));
  assert.notEqual(fresh.data.order_id, previous.id);
  assert.equal(
    fresh.data.customer_context.customer_id,
    f.session.data.customer_context.customer_id,
  );
  assert.equal(fresh.data.customer_context.display_name, "Ana");
  assert.equal(fresh.data.customer_context.verified, false);
  assert.equal(fresh.data.order.customer.name, null);
  assert.deepEqual(fresh.data.order.items, []);
  assert.equal(fresh.data.order.total, 0);

  const named = await f.call(
    "tools/apply_order_operations",
    "POST",
    {
      session_id: fresh.data.session_id,
      request_id: "confirmed-name",
      utterance: "Sí, soy Ana",
      operations_json: JSON.stringify([
        { action: "set_customer_name", name: "Ana" },
      ]),
    },
    true,
  );
  assert.equal(named.status, 200, JSON.stringify(named.data));
  assert.equal(named.data.order.customer.name, "Ana");
  assert.deepEqual(named.data.order.items, []);
  assert.equal(named.data.order.total, 0);
  const history = await f.call(
    "tools/get_previous_orders",
    "POST",
    { session_id: fresh.data.session_id },
    true,
  );
  assert.equal(
    history.status,
    403,
    "Name confirmation does not grant protected history access.",
  );
  const unchanged = await f.repo.loadByMerchant(f.env.AGENT_MERCHANT_ID);
  assert.deepEqual(
    unchanged!.state.orders.find((order) => order.id === previous.id),
    previous,
  );
});

test("a name given after session creation is recognized on a later call without carrying items or verification", async () => {
  const f = await fixture();
  const first = await f.call(
    "tools/create_session",
    "POST",
    {
      request_id: "unknown-caller",
      phone: "+525555550999",
    },
    true,
  );
  assert.equal(first.status, 201);
  assert.equal(first.data.customer_context.display_name, null);
  const named = await f.call(
    "tools/apply_order_operations",
    "POST",
    {
      session_id: first.data.session_id,
      request_id: "new-name",
      utterance: "Me llamo Luisa",
      operations_json: JSON.stringify([
        { action: "set_customer_name", name: "Luisa" },
      ]),
    },
    true,
  );
  assert.equal(named.status, 200, JSON.stringify(named.data));
  const next = await f.call(
    "tools/create_session",
    "POST",
    {
      request_id: "returning-caller",
      phone: "+525555550999",
    },
    true,
  );
  assert.equal(next.status, 201);
  assert.equal(next.data.customer_context.display_name, "Luisa");
  assert.equal(next.data.customer_context.verified, false);
  assert.equal(next.data.order.customer.name, null);
  assert.deepEqual(next.data.order.items, []);
  assert.equal(next.data.order.total, 0);
});

test("verified capability authorizes only its bound session and saved preferences persist", async () => {
  const f = await fixture();
  const sessionId = f.session.data.session_id;
  const context = f.session.data.customer_context;
  const challenge = await f.call(
    `customers/${context.customer_id}/verification-link`,
    "POST",
    { session_id: sessionId },
  );
  assert.equal(challenge.status, 201, JSON.stringify(challenge.data));
  const token = new URL(challenge.data.url).hash.slice(1);
  const completed = await f.call("customer/verify", "POST", { token }, false, {
    Origin: f.origin,
  });
  assert.equal(completed.status, 200, JSON.stringify(completed.data));
  const verifiedAgain = await f.call(
    "tools/verify_customer",
    "POST",
    { session_id: sessionId, consent: true },
    true,
  );
  assert.equal(verifiedAgain.status, 200);
  assert.equal(
    verifiedAgain.data.verified,
    true,
    "polling must not replace a verified result with a fresh challenge",
  );
  assert.equal(
    (await f.repo.loadByMerchant(f.env.AGENT_MERCHANT_ID))!.state
      .customer_automation?.jobs.length ?? 0,
    0,
  );
  const saved = await f.call(
    "tools/update_customer_preference",
    "POST",
    {
      session_id: sessionId,
      preference_key: "milk",
      preference_value: "oat",
      scope: "permanent",
      confirmed: true,
    },
    true,
  );
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const next = await f.call(
    "tools/create_session",
    "POST",
    { request_id: "fresh", phone: "+525555550123" },
    true,
  );
  const preferences = await f.call(
    "tools/get_customer_preferences",
    "POST",
    { session_id: next.data.session_id },
    true,
  );
  assert.equal(preferences.status, 200, JSON.stringify(preferences.data));
  assert.match(JSON.stringify(preferences.data), /oat/);
  const history = await f.call(
    "tools/get_previous_orders",
    "POST",
    { session_id: next.data.session_id },
    true,
  );
  assert.equal(
    history.status,
    403,
    "verification must not carry into an unrelated call",
  );
  const replay = await f.call("customer/verify", "POST", { token }, false, {
    Origin: f.origin,
  });
  assert.equal(replay.status, 401);
  const bootstrap = await f.call("bootstrap");
  assert.equal(JSON.stringify(bootstrap.data).includes(token), false);
  assert.equal("customer_memory" in bootstrap.data, false);
});

test("customer routes reject another merchant and customer verification rejects foreign origins", async () => {
  const f = await fixture();
  const response = await handleRequest(
    new Request(
      `https://ring.test/api/customers/${f.session.data.customer_context.customer_id}`,
      { headers: { "oai-authenticated-user-id": "other-owner" } },
    ),
    f.env,
    f.repo,
  );
  assert.equal(response.status, 404);
  const denied = await f.call(
    "customer/verify",
    "POST",
    { token: "invalid" },
    false,
    { Origin: "https://attacker.example" },
  );
  assert.equal(denied.status, 403);
});
