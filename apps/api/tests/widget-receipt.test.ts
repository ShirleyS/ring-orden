import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { sendPendingCustomerReceipt } from "../src/customer-receipt-delivery.ts";
import { MemoryRepository } from "../src/repository.ts";
import { buildElevenLabsToolConfigs } from "../../../prompts/elevenlabs-tool-configs.mjs";
const env = {
  TRUST_SITES_HEADERS: "true",
  AGENT_TOOL_SECRET: "widget-receipt-test-secret",
  CUSTOMER_APP_ORIGIN: "https://ringorden.lovable.app",
};
async function fixture() {
  const repo = new MemoryRepository();
  const call = async (path: string, body?: unknown, owner = "owner") => {
    const r = await handleRequest(
      new Request("https://ring.test/api/" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          "Content-Type": "application/json",
          "oai-authenticated-user-id": owner,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      repo,
    );
    return { status: r.status, data: (await r.json()) as any };
  };
  const boot = await call("bootstrap");
  const merchant = boot.data.merchant.id;
  const config = buildElevenLabsToolConfigs({
    apiOrigin: "https://ring.test",
    secretId: "test",
  }).find((t) => t.name === "create_session");
  assert.ok(config);
  assert.equal(
    config.api_schema.request_body_schema.properties.request_id
      .dynamic_variable,
    "system__conversation_id",
  );
  const createdResponse = await handleRequest(
    new Request("https://ring.test/api/tools/create_session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + env.AGENT_TOOL_SECRET,
      },
      body: JSON.stringify({ request_id: "conv-receipt" }),
    }),
    { ...env, AGENT_MERCHANT_ID: merchant },
    repo,
  );
  assert.equal(createdResponse.status, 201);
  const sessionId = ((await createdResponse.json()) as any).session_id;
  const row = (await repo.loadByMerchant(merchant))!;
  const session = row.state.sessions.find((s) => s.id === sessionId)!;
  assert.equal(session.provider_conversation_id, "conv-receipt");
  const order = row.state.orders.find((o) => o.id === session.order_id)!;
  order.items = [
    {
      id: "line",
      catalog_item_id: "latte",
      name: "Latte",
      quantity: 2,
      unit_price: 50,
      modifiers: [],
      notes: [],
    } as any,
  ];
  order.total = 100;
  order.subtotal = 100;
  order.status = "PAYMENT_PENDING";
  await repo.saveTrusted(merchant, row.revision, row.state);
  return { repo, call, merchant, order, session };
}
test("ended call gets its own real Lovable receipt with stable retries and no provider send", async () => {
  const f = await fixture();
  const first = await f.call("voice/receipt", {
    conversation_id: "conv-receipt",
  });
  assert.equal(first.status, 200, JSON.stringify(first.data));
  assert.equal(first.data.status, "READY");
  assert.match(
    first.data.message.link.url,
    /^https:\/\/ringorden.lovable.app\/receipt#/,
  );
  assert.match(first.data.message.text, /100\.00 MXN/);
  assert.match(first.data.message.text, /Pago pendiente/);
  const again = await f.call("voice/receipt", {
    conversation_id: "conv-receipt",
  });
  assert.deepEqual(again.data, first.data);
  const stored = (await f.repo.loadByMerchant(f.merchant))!;
  assert.equal(
    JSON.stringify(stored).includes(first.data.message.link.url),
    false,
  );
  const token = new URL(first.data.message.link.url).hash.slice(1);
  const view = await handleRequest(
    new Request("https://ring.test/api/customer/receipt", {
      headers: { Authorization: "Bearer " + token },
    }),
    env,
    f.repo,
  );
  assert.equal(view.status, 200);
  assert.equal(
    ((await view.json()) as any).order.reference,
    f.order.external_reference,
  );
  assert.equal(
    JSON.stringify((await f.call("orders")).data).includes("widget_receipt"),
    false,
  );
});
test("unbound and draft calls do not receive another order receipt", async () => {
  const f = await fixture();
  assert.equal(
    (await f.call("voice/receipt", { conversation_id: "missing" })).data.status,
    "WAITING_SESSION",
  );
  const row = (await f.repo.loadByMerchant(f.merchant))!;
  row.state.orders.find((o) => o.id === f.order.id)!.status = "DRAFT";
  await f.repo.saveTrusted(f.merchant, row.revision, row.state);
  assert.equal(
    (await f.call("voice/receipt", { conversation_id: "conv-receipt" })).data
      .status,
    "UNCONFIRMED",
  );
});
test("receipt endpoint denies other tenants and staff and does not revive a revoked grant", async () => {
  const f = await fixture();
  assert.equal(
    (
      await f.call(
        "voice/receipt",
        { conversation_id: "conv-receipt" },
        "other",
      )
    ).data.status,
    "WAITING_SESSION",
  );
  f.repo.members.push({
    merchant_id: f.merchant,
    subject: "sites:staff",
    role: "STAFF",
    email: "staff@example.test",
    name: "Staff",
  });
  assert.equal(
    (
      await f.call(
        "voice/receipt",
        { conversation_id: "conv-receipt" },
        "staff",
      )
    ).status,
    403,
  );
  await f.call("voice/receipt", { conversation_id: "conv-receipt" });
  const row = (await f.repo.loadByMerchant(f.merchant))!;
  delete row.state.order_metadata[f.order.id].receipt_link;
  await f.repo.saveTrusted(f.merchant, row.revision, row.state);
  assert.equal(
    (await f.call("voice/receipt", { conversation_id: "conv-receipt" })).status,
    410,
  );
});
test("late confirmation delivery cannot rotate a receipt already sent to the stub widget", async () => {
  const f = await fixture();
  let row = (await f.repo.loadByMerchant(f.merchant))!;
  row.state.orders.find((o) => o.id === f.order.id)!.customer.phone =
    "+525555550123";
  row.state.order_metadata[f.order.id].receipt_consent = {
    phone: "+525555550123",
    recorded_at: new Date().toISOString(),
  };
  row.state.order_metadata[f.order.id].delivery_status = "PROCESSING";
  await f.repo.saveTrusted(f.merchant, row.revision, row.state);
  assert.equal(
    (await f.call("voice/receipt", { conversation_id: "conv-receipt" })).data
      .status,
    "WAITING_SESSION",
  );
  row = (await f.repo.loadByMerchant(f.merchant))!;
  row.state.order_metadata[f.order.id].delivery_status = "DONE";
  await f.repo.saveTrusted(f.merchant, row.revision, row.state);
  const issued = await f.call("voice/receipt", {
    conversation_id: "conv-receipt",
  });
  assert.equal(
    (await sendPendingCustomerReceipt(f.repo, f.merchant, f.order.id, env))
      .status,
    "STUB_PHONE",
  );
  const token = new URL(issued.data.message.link.url).hash.slice(1);
  const view = await handleRequest(
    new Request("https://ring.test/api/customer/receipt", {
      headers: { Authorization: "Bearer " + token },
    }),
    env,
    f.repo,
  );
  assert.equal(
    view.status,
    200,
    "late receipt send must preserve the widget link",
  );
});

test("delivery phone receipt includes address, fees and the authoritative total", async () => {
  const f = await fixture();
  const row = (await f.repo.loadByMerchant(f.merchant))!;
  const order = row.state.orders.find(o => o.id === f.order.id)!;
  order.fulfillment = {type:"delivery",scheduled_for:null,delivery_address:"100 Example Street"};
  order.fees = 40;
  order.total = 140;
  await f.repo.saveTrusted(f.merchant,row.revision,row.state);
  const response = await f.call("voice/receipt",{conversation_id:"conv-receipt"});
  assert.equal(response.status,200);
  assert.match(response.data.message.text,/Entrega a domicilio: 100 Example Street/);
  assert.match(response.data.message.text,/40.00 MXN/);
  assert.match(response.data.message.text,/Total: 140.00 MXN/);
});
