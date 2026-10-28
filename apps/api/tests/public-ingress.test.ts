import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import { handlePublicIngress } from "../../../netlify/ingress.ts";

async function fixture() {
  const repository = new MemoryRepository();
  const bootstrap = await handleRequest(
    new Request("https://ring.test/api/bootstrap", {
      headers: { "oai-authenticated-user-id": "ring-owner" },
    }),
    { TRUST_SITES_HEADERS: "true" },
    repository,
  );
  const data = (await bootstrap.json()) as { merchant: { id: string } };
  const merchant = data.merchant;
  const env = {
    AGENT_TOOL_SECRET: "ingress-test-secret",
    AGENT_MERCHANT_ID: merchant.id,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVER_SECRET: "test-server-secret",
  };
  return { repository, env };
}

test("public ingress serves only the configured merchant's allowlisted agent tools", async () => {
  const { repository, env } = await fixture();
  const response = await handlePublicIngress(
    new Request("https://ring-api.test/api/tools/get_business_info", {
      method: "POST",
      headers: {
        authorization: "Bearer ingress-test-secret",
        "content-type": "application/json",
        "oai-authenticated-user-id": "attacker",
      },
      body: "{}",
    }),
    env,
    repository,
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(response.headers.get("Content-Security-Policy"), "default-src 'none'");
  assert.equal(response.headers.get("Referrer-Policy"), "no-referrer");
  const data = (await response.json()) as { id: string };
  assert.equal(data.id, env.AGENT_MERCHANT_ID);
});

test("public ingress rejects merchant APIs and internal agent tools", async () => {
  const { repository, env } = await fixture();
  for (const path of [
    "/api/bootstrap",
    "/api/orders",
    "/api/settings",
    "/api/voice/signed-url",
    "/api/tools/model_health",
    "/api/tools/retry_failed_pos",
  ]) {
    const response = await handlePublicIngress(
      new Request("https://ring-api.test" + path, { method: "POST" }),
      env,
      repository,
    );
    assert.equal(response.status, 404, path);
  }
});

test("public ingress refuses oversized request bodies before application parsing", async () => {
  const { repository, env } = await fixture();
  const response = await handlePublicIngress(
    new Request("https://ring-api.test/api/tools/process_order_turn", {
      method: "POST",
      headers: {
        authorization: "Bearer ingress-test-secret",
        "content-type": "application/json",
      },
      body: "x".repeat(128 * 1024 + 1),
    }),
    env,
    repository,
  );
  assert.equal(response.status, 413);
});

test("public ingress requires the Supabase and agent tenant binding", async () => {
  const response = await handlePublicIngress(
    new Request("https://ring-api.test/api/tools/get_menu", {
      method: "POST",
      headers: {
        authorization: "Bearer secret",
        "content-type": "application/json",
      },
      body: "{}",
    }),
    { AGENT_TOOL_SECRET: "secret" },
  );
  assert.equal(response.status, 503);
});
