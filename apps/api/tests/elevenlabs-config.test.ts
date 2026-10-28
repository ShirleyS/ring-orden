import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildElevenLabsToolConfigs } from "../../../prompts/elevenlabs-tool-configs.mjs";

test("ElevenLabs webhook configs use valid value sources and only supported API routes", () => {
  const tools = buildElevenLabsToolConfigs({
    apiOrigin: "https://ring-orden-api.netlify.app",
    secretId: "secret_id_test",
  });
  const contract = JSON.parse(
    readFileSync(
      new URL("../../../prompts/elevenlabs-tools.openapi.json", import.meta.url),
      "utf8",
    ),
  );

  assert.equal(tools.length, Object.keys(contract.paths).length);
  const names = new Set();
  for (const tool of tools) {
    assert.equal(tool.type, "webhook");
    assert.match(tool.api_schema.url, /^https:\/\/ring-orden-api\.netlify\.app\/api\/tools\//);
    assert.equal(tool.api_schema.method, "POST");
    assert.deepEqual(tool.api_schema.request_headers.Authorization, {
      secret_id: "secret_id_test",
    });
    assert.equal(tool.api_schema.request_headers["Content-Type"], "application/json");
    assert.equal(tool.api_schema.request_body_schema.type, "object");
    assert.ok(tool.name);
    assert.ok(!names.has(tool.name), `duplicate tool name ${tool.name}`);
    names.add(tool.name);

    const schema = tool.api_schema.request_body_schema;
    for (const [property, definition] of Object.entries(schema.properties)) {
      const sources = [
        Boolean(definition.description?.trim()),
        Boolean(definition.dynamic_variable),
        Object.hasOwn(definition, "constant_value"),
        definition.is_system_provided === true,
      ].filter(Boolean);
      assert.equal(sources.length, 1, `${tool.name}.${property} needs one value source`);
    }
    for (const required of schema.required)
      assert.ok(Object.hasOwn(schema.properties, required), `${tool.name}.${required} is missing`);
  }
});

test("create_session binds one server session ID to the conversation ID", () => {
  const tools = buildElevenLabsToolConfigs({
    apiOrigin: "https://ring-orden-api.netlify.app",
    secretId: "secret_id_test",
  });
  const create = tools.find((tool) => tool.name === "create_session");
  assert.ok(create);
  const properties = create.api_schema.request_body_schema
    .properties as Record<string, { dynamic_variable?: string }>;
  assert.equal(
    properties.request_id?.dynamic_variable,
    "system__conversation_id",
  );
  assert.ok(create.assignments.some((assignment) => assignment.dynamic_variable === "ring_orden_session_id"));
});

test("order escalations carry an idempotency key in the published request contract", () => {
  const contract = JSON.parse(
    readFileSync(
      new URL("../../../prompts/elevenlabs-tools.openapi.json", import.meta.url),
      "utf8",
    ),
  );
  for (const tool of ["request_human", "escalate_issue"]) {
    const schema = contract.paths[`/api/tools/${tool}`].post.requestBody.content[
      "application/json"
    ].schema;
    assert.ok(schema.required.includes("request_id"), `${tool} must require request_id`);
  }
});
