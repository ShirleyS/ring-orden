import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import { seedTenant } from "../src/seed.ts";

const workflow = JSON.parse(
  readFileSync(
    new URL("../../../n8n/g-onboarding.json", import.meta.url),
    "utf8",
  ),
);

/** Execute the imported workflow's real pre-request nodes with one webhook item. */
function forwardedBody(input: Record<string, unknown>) {
  let node = workflow.nodes.find((n: { type: string }) =>
    n.type.endsWith(".webhook"),
  );
  let item = { json: input };
  for (let step = 0; step < workflow.nodes.length; step++) {
    if (node.type.endsWith(".httpRequest")) {
      const expression = node.parameters.jsonBody;
      const encoded = new Function(
        "$json",
        "return (" + expression.slice(3, -2) + ");",
      )(item.json);
      return JSON.parse(encoded) as Record<string, unknown>;
    }
    if (node.type.endsWith(".code")) {
      const output = new Function("$input", node.parameters.jsCode)({
        first: () => item,
      });
      assert.equal(output.length, 1);
      item = output[0];
    }
    const next = workflow.connections[node.name]?.main?.[0]?.[0]?.node;
    node = workflow.nodes.find((n: { name: string }) => n.name === next);
    assert.ok(node, "The webhook must reach the backend request");
  }
  throw new Error("The workflow did not reach its backend request");
}

test("n8n session creation rejects absent or unusable retry IDs before a backend request", () => {
  for (const request_id of [undefined, "", "   ", 5, "x".repeat(201)]) {
    assert.throws(
      () => forwardedBody({ body: { request_id, phone: "+525555501234" } }),
      /request_id/,
    );
  }
});

test("n8n forwards caller data and stable retry ID without webhook headers", async () => {
  const payload = {
    request_id: "call-create-42",
    name: "Caller",
    phone: "+525555501234",
  };
  const body = forwardedBody({
    body: payload,
    headers: { authorization: "private-inbound-header" },
  });
  assert.deepEqual(body, payload);
  const repo = new MemoryRepository();
  await repo.create(
    "merchant-n8n",
    "owner",
    seedTenant(
      "merchant-n8n",
      {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        provider: "sites",
      },
      true,
    ),
  );
  const invoke = async () => {
    const response = await handleRequest(
      new Request("https://ring.test/api/tools/create_session", {
        method: "POST",
        headers: {
          Authorization: "Bearer agent-test-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      {
        AGENT_TOOL_SECRET: "agent-test-token",
        AGENT_MERCHANT_ID: "merchant-n8n",
      },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  const first = await invoke();
  const retry = await invoke();
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(first.data.session_id, retry.data.session_id);
  assert.equal(first.data.order.customer.phone, payload.phone);
  assert.equal(first.data.order.customer.name, payload.name);
});
