import test from "node:test";
import assert from "node:assert/strict";
// Tool configs are authored JavaScript for importing in the provider's workspace.
const { buildElevenLabsToolConfigs } = await import(
  "../../../prompts/elevenlabs-tool-configs.mjs"
);
test("invoice tool can satisfy backend confirmation and reorders update the active session", () => {
  const configs: any[] = buildElevenLabsToolConfigs({
    apiOrigin: "https://ring-api.example",
    secretId: "workspace-secret-reference",
  });
  const invoice = configs.find((c: any) => c.name === "request_invoice");
  assert.ok(
    invoice.api_schema.request_body_schema.required.includes("confirmed"),
  );
  assert.equal(
    invoice.api_schema.request_body_schema.properties.confirmed.type,
    "boolean",
  );
  const reorder = configs.find((c: any) => c.name === "reorder_previous_order");
  assert.ok(
    reorder.assignments.some(
      (a: any) =>
        a.dynamic_variable === "ring_orden_session_id" &&
        a.value_path === "session_id",
    ),
  );
  const consent = configs.find(
    (c: any) => c.name === "set_customer_followup_consent",
  );
  assert.ok(
    consent.api_schema.request_body_schema.required.includes("utterance"),
  );
  for (const config of configs) {
    assert.equal(
      config.api_schema.url.startsWith("https://ring-api.example/api/tools/"),
      true,
    );
    assert.equal(
      config.api_schema.request_headers.Authorization.secret_id,
      "workspace-secret-reference",
    );
  }
});
