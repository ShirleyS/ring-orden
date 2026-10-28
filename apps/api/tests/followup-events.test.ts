import test from "node:test";
import assert from "node:assert/strict";
import {
  createOrder,
  applyOperation,
} from "../../../packages/ring-orden-core/src/index.ts";
import { seedTenant } from "../src/seed.ts";
import { MemoryRepository } from "../src/repository.ts";
import {
  saveFollowupConsent,
  handleElevenLabsEvent,
  queueCompletedReceipts,
} from "../src/followup-events.ts";

const env = {
  AGENT_TOOL_SECRET: "synthetic-followup-secret",
  AGENT_MERCHANT_ID: "event-merchant",
  ELEVENLABS_AGENT_ID: "agent-test",
  ELEVENLABS_WEBHOOK_SECRET: "synthetic-webhook-signature",
  CUSTOMER_APP_ORIGIN: "https://order.example",
};
async function fixture() {
  const repo = new MemoryRepository();
  const state = seedTenant(
    env.AGENT_MERCHANT_ID,
    {
      id: "event-owner",
      name: "Test",
      email: "test@example.com",
      provider: "sites",
    },
    false,
  );
  let order = createOrder(state.merchant.id);
  order.customer = { name: "Ana", phone: "+525555550123" };
  order = applyOperation(
    order,
    {
      action: "add_item",
      catalog_item_id: "iced_latte",
      modifier_ids: ["oat_milk"],
    },
    state.catalog,
  );
  state.orders.push(order);
  state.order_metadata[order.id] = {
    pos_status: "DASHBOARD_ONLY",
    notification_status: "PENDING",
    demo: false,
  };
  const session = {
    id: "session-event",
    order_id: order.id,
    provider_conversation_id: "conversation-event",
    turns: [],
    created_at: new Date().toISOString(),
    status: "ACTIVE",
    pending_corrections: [],
  };
  state.sessions.push(session);
  await repo.create(state.merchant.id, "event-owner", state);
  return { repo, state, order, session };
}
async function request(
  body: unknown,
  secret = env.ELEVENLABS_WEBHOOK_SECRET,
  seconds = Math.floor(Date.now() / 1000),
) {
  const raw = JSON.stringify(body);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${seconds}.${raw}`),
  );
  const hex = Array.from(new Uint8Array(digest), (v) =>
    v.toString(16).padStart(2, "0"),
  ).join("");
  return new Request("https://ring.test/api/webhooks/elevenlabs", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "ElevenLabs-Signature": `t=${seconds},v0=${hex}`,
    },
    body: raw,
  });
}
const event = () => ({
  type: "post_call_transcription",
  event_timestamp: Math.floor(Date.now() / 1000),
  data: {
    agent_id: env.ELEVENLABS_AGENT_ID,
    conversation_id: "conversation-event",
    metadata: {
      start_time_unix_secs: Math.floor(Date.now() / 1000) - 120,
      call_duration_secs: 120,
    },
    transcript: [{ message: "private text must not be persisted" }],
  },
});

test("signed ended call resumes identical draft for ten minutes only with prior consent", async () => {
  const f = await fixture();
  saveFollowupConsent(f.state, f.session, {
    purpose: "recovery",
    consent: true,
    utterance: "Sí, mándame el enlace si se corta.",
  });
  await f.repo.saveTrusted(f.state.merchant.id, 0, f.state);
  const original = JSON.stringify(f.order);
  const response = await handleElevenLabsEvent(
    await request(event()),
    env,
    f.repo,
  );
  assert.equal(response.status, 200, await response.text());
  const stored = await f.repo.loadByMerchant(f.state.merchant.id);
  const job = stored!.state.customer_automation!.jobs[0];
  assert.equal(job.purpose, "recovery");
  assert.equal(job.order_id, f.order.id);
  assert.equal(
    JSON.stringify(stored!.state.orders.find((o) => o.id === f.order.id)),
    original,
  );
  assert.ok(Date.parse(job.expires_at) <= Date.now() + 600000);
  assert.ok(Date.parse(job.expires_at) > Date.now() + 598000);
  assert.equal(
    JSON.stringify(stored).includes("private text must not be persisted"),
    false,
  );
  const duplicate = await handleElevenLabsEvent(
    await request(event()),
    env,
    f.repo,
  );
  assert.equal(duplicate.status, 200);
  assert.equal(
    (await f.repo.loadByMerchant(f.state.merchant.id))!.state
      .customer_automation!.jobs.length,
    1,
  );
});
test("invalid, stale or different-agent callbacks cannot enqueue; absent consent never sends", async () => {
  const f = await fixture();
  for (const req of [
    await request(event(), "wrong"),
    await request(
      event(),
      env.ELEVENLABS_WEBHOOK_SECRET,
      Math.floor(Date.now() / 1000) - 600,
    ),
  ])
    assert.equal((await handleElevenLabsEvent(req, env, f.repo)).status, 401);
  const wrong = event();
  wrong.data.agent_id = "other-agent";
  assert.equal(
    (await handleElevenLabsEvent(await request(wrong), env, f.repo)).status,
    403,
  );
  assert.equal(
    (await handleElevenLabsEvent(await request(event()), env, f.repo)).status,
    200,
  );
  assert.equal(
    (await f.repo.loadByMerchant(f.state.merchant.id))!.state
      .customer_automation?.jobs?.length ?? 0,
    0,
  );
});
test("completed receipts require saved purpose-specific consent and queue once", async () => {
  const f = await fixture();
  f.order.status = "COMPLETED";
  f.order.payment_status = "PAID";
  f.state.orders = f.state.orders.map((o) =>
    o.id === f.order.id ? f.order : o,
  );
  await queueCompletedReceipts(f.state, env);
  assert.equal(f.state.customer_automation?.jobs.length ?? 0, 0);
  saveFollowupConsent(f.state, f.session, {
    purpose: "receipt",
    consent: true,
    utterance: "Sí, envíame el recibo al terminar.",
  });
  await queueCompletedReceipts(f.state, env);
  await queueCompletedReceipts(f.state, env);
  assert.equal(f.state.customer_automation!.jobs.length, 1);
  assert.equal(f.state.customer_automation!.jobs[0].purpose, "receipt");
});
