import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";

const contract = JSON.parse(
  readFileSync(
    new URL("../../../prompts/elevenlabs-tools.openapi.json", import.meta.url),
    "utf8",
  ),
);

// Validate the subset of JSON Schema used by the shipped webhook contracts,
// then exercise those documented inputs against the actual backend handler.
function validateInput(tool: string, input: Record<string, unknown>) {
  const schema =
    contract.paths["/api/tools/" + tool].post.requestBody.content[
      "application/json"
    ].schema;
  for (const key of schema.required ?? [])
    assert.ok(Object.hasOwn(input, key), "Missing property " + key);
  for (const [key, value] of Object.entries(input)) {
    const field = schema.properties[key];
    assert.ok(
      field || schema.additionalProperties !== false,
      "Unexpected property " + key,
    );
    if (!field) continue;
    if (field.type) assert.equal(typeof value, field.type, key);
    if (typeof value === "string") {
      if (field.minLength !== undefined)
        assert.ok(value.length >= field.minLength, key + " too short");
      if (field.maxLength !== undefined)
        assert.ok(value.length <= field.maxLength, key + " too long");
      if (field.pattern) assert.match(value, new RegExp(field.pattern), key);
    }
    if (field.const !== undefined) assert.equal(value, field.const, key);
  }
}
async function fixture() {
  const repo = new MemoryRepository();
  const response = await handleRequest(
    new Request("https://ring.test/api/bootstrap", {
      headers: { "oai-authenticated-user-id": "voice-owner" },
    }),
    { TRUST_SITES_HEADERS: "true" },
    repo,
  );
  const boot = (await response.json()) as any;
  const call = async (
    tool: string,
    body: Record<string, unknown>,
    validate = true,
  ) => {
    if (validate) validateInput(tool, body);
    const response = await handleRequest(
      new Request("https://ring.test/api/tools/" + tool, {
        method: "POST",
        headers: {
          Authorization: "Bearer voice-tool-secret",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      {
        AGENT_TOOL_SECRET: "voice-tool-secret",
        AGENT_MERCHANT_ID: boot.merchant.id,
      },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  return {
    repo,
    boot,
    call,
    state: () => repo.rows.get(boot.merchant.id)!.state,
  };
}
test("documented session input preserves caller phone/name and replays the same creation request", async () => {
  const client = await fixture();
  const initial = client.state().sessions.length;
  const input = {
    name: "Voice Caller",
    phone: "+525555010101",
    request_id: "eleven-call-start-1",
  };
  const first = await client.call("create_session", input);
  const replay = await client.call("create_session", input);
  assert.equal(first.status, 201);
  assert.equal(first.data.order.customer.name, "Voice Caller");
  assert.equal(first.data.order.customer.phone, "+525555010101");
  assert.equal(replay.data.session_id, first.data.session_id);
  assert.equal(client.state().sessions.length, initial + 1);
  assert.ok(
    contract.paths["/api/tools/create_session"].post.responses[
      String(first.status)
    ],
  );
});

test("session contract rejects missing retry identity and unsupported conversation lookup fields", () => {
  assert.throws(() => validateInput("create_session", {}), /request_id/);
  assert.throws(
    () => validateInput("create_session", { request_id: "" }),
    /request_id/,
  );
  assert.throws(
    () => validateInput("create_session", { request_id: "   " }),
    /request_id/,
  );
  assert.throws(
    () =>
      validateInput("create_session", {
        request_id: "start-2",
        conversation_id: "unsupported-lookup",
      }),
    /conversation_id/,
  );
});

test("confirmation retains the caller's exact consent instead of synthetic words", async () => {
  const client = await fixture();
  const session = (
    await client.call("create_session", { request_id: "consent-start" })
  ).data.session_id;
  await client.call("process_order_turn", {
    session_id: session,
    utterance: "One latte",
    request_id: "consent-order",
  });
  const utterance = "Sí, confirmo mi pedido.";
  const result = await client.call("confirm_order", {
    session_id: session,
    utterance,
    confirmed: true,
    request_id: "consent-yes",
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.order.status, "PAYMENT_PENDING");
  const saved = client.state().sessions.find((s) => s.id === session)!;
  assert.equal(
    saved.turns.filter((t) => t.role === "user").at(-1)?.text,
    utterance,
  );
});

test("a caller's refusal cannot become confirmation even if the tool boolean is true", async () => {
  const client = await fixture();
  const session = (
    await client.call("create_session", { request_id: "refusal-start" })
  ).data.session_id;
  await client.call("process_order_turn", {
    session_id: session,
    utterance: "One latte",
    request_id: "refusal-order",
  });
  const result = await client.call("confirm_order", {
    session_id: session,
    utterance: "No, do not place it.",
    confirmed: true,
    request_id: "refusal-no",
  });
  assert.ok([200, 422].includes(result.status), JSON.stringify(result.data));
  const order = client
    .state()
    .orders.find(
      (o) =>
        o.id ===
        client.state().sessions.find((s) => s.id === session)!.order_id,
    )!;
  assert.ok(!["CONFIRMED", "PAYMENT_PENDING", "PAID"].includes(order.status));
  const guard = await client.call(
    "confirm_order",
    {
      session_id: session,
      utterance: "Yes, confirm my order.",
      confirmed: false,
      request_id: "false-boolean",
    },
    false,
  );
  assert.equal(guard.status, 422);
});

test("business information exposes actual hours and public ordering rules without private configuration", async () => {
  const client = await fixture();
  const state = client.state();
  const schedule = { mon: { enabled: true, open: "09:00", close: "18:00" } };
  Object.assign(state.settings.business, {
    hours: "Monday 09:00–18:00",
    schedule,
    special_closures: ["2026-12-25"],
    minimum_order: 20,
    maximum_order: 500,
    maximum_quantity: 12,
    tax_rate: 0.16,
    api_key: "private-business-sentinel",
  });
  Object.assign(state.settings.agent, {
    pickup_minutes: 25,
    after_hours: "scheduled_orders",
    enabled: false,
    instructions: "private-agent-instructions",
    handoff_number: "+525555999999",
  });
  state.settings.model.api_key = "private-model-sentinel";
  state.merchant.notification_phone = "+525555888888";
  const result = await client.call("get_business_info", {});
  assert.equal(result.status, 200);
  assert.equal(result.data.hours, "Monday 09:00–18:00");
  assert.deepEqual(result.data.schedule, schedule);
  assert.deepEqual(result.data.special_closures, ["2026-12-25"]);
  assert.deepEqual(result.data.order_rules, {
    minimum_order: 20,
    maximum_order: 500,
    maximum_quantity: 12,
    tax_rate: 0.16,
    pickup_minutes: 25,
    after_hours: "scheduled_orders",
    ordering_enabled: false,
  });
  const serialized = JSON.stringify(result.data);
  for (const secret of [
    "private-business-sentinel",
    "private-agent-instructions",
    "private-model-sentinel",
    "+525555888888",
    "+525555999999",
  ])
    assert.equal(serialized.includes(secret), false);
});

test("tool schema and backend share the same 1500-character turn boundary", async () => {
  const client = await fixture();
  const session = (
    await client.call("create_session", { request_id: "length-start" })
  ).data.session_id;
  const valid = {
    session_id: session,
    utterance: "x".repeat(1500),
    request_id: "long-valid",
  };
  const accepted = await client.call("process_order_turn", valid);
  assert.equal(accepted.status, 200);
  assert.throws(
    () =>
      validateInput("process_order_turn", {
        ...valid,
        utterance: "x".repeat(1501),
      }),
    /too long/,
  );
  const rejected = await client.call(
    "process_order_turn",
    { ...valid, utterance: "x".repeat(1501), request_id: "long-invalid" },
    false,
  );
  assert.equal(rejected.status, 422);
});

test("spoken Sí señor confirms the saved read-back order and preserves the actual consent words", async () => {
  const client = await fixture();
  const session = (
    await client.call("create_session", { request_id: "polite-start" })
  ).data.session_id;
  await client.call("process_order_turn", {
    session_id: session,
    utterance: "One latte",
    request_id: "polite-order",
  });
  const result = await client.call("confirm_order", {
    session_id: session,
    utterance: "Sí, señor.",
    confirmed: true,
    request_id: "polite-yes",
  });
  assert.equal(result.status, 200);
  assert.equal(result.data.order.status, "PAYMENT_PENDING");
  assert.equal(
    client
      .state()
      .sessions.find((s) => s.id === session)!
      .turns.filter((t) => t.role === "user")
      .at(-1)?.text,
    "Sí, señor.",
  );
});
