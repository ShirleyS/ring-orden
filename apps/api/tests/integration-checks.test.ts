import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
const client =
  (repo: MemoryRepository, env: Record<string, unknown> = {}) =>
  async (path: string, body: unknown = {}) => {
    const response = await handleRequest(
      new Request("https://ring.test/api/" + path, {
        method: path === "settings" ? "PATCH" : "POST",
        headers: {
          "oai-authenticated-user-id": "owner",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      { TRUST_SITES_HEADERS: "true", ...env },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
test("unconfigured integration never makes a provider request", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    throw new Error("Unexpected provider call");
  };
  try {
    const result = await client(new MemoryRepository())(
      "integrations/square/test",
    );
    assert.equal(result.status, 503);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
test("Square connection test invokes actual adapter location check and reports failed connection honestly", async () => {
  const original = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return new Response("{}", { status: 401 });
  };
  try {
    const result = await client(new MemoryRepository(), {
      SQUARE_ACCESS_TOKEN: "test-token",
      SQUARE_LOCATION_ID: "location-test",
    })("integrations/square/test");
    assert.equal(result.status, 200);
    assert.equal(result.data.connected, false);
    assert.equal(result.data.status, "failed");
    assert.ok(calls[0].endsWith("/v2/locations/location-test"));
    assert.equal(JSON.stringify(result.data).includes("test-token"), false);
  } finally {
    globalThis.fetch = original;
  }
});
test("webhook connection test sends HEAD with saved bearer token and returns measured result", async () => {
  const original = globalThis.fetch;
  const calls: { url: string; method?: string; headers: Headers }[] = [];
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      method: init?.method,
      headers: new Headers(init?.headers),
    });
    return new Response(null, { status: 204 });
  };
  try {
    const run = client(new MemoryRepository());
    await run("settings", {
      section: "pos",
      values: {
        provider: "webhook",
        endpoint: "https://merchant.example.com/orders",
        token: "saved-token",
      },
    });
    const result = await run("integrations/webhook/test");
    assert.equal(result.data.connected, true);
    assert.equal(calls[0].method, "HEAD");
    assert.equal(calls[0].headers.get("Authorization"), "Bearer saved-token");
    assert.equal(typeof result.data.latency_ms, "number");
  } finally {
    globalThis.fetch = original;
  }
});
test("Twilio messaging check supports a restricted API key without returning the key", async () => {
  const original = globalThis.fetch;
  let request: { url: string; authorization: string | null } | undefined;
  globalThis.fetch = async (url, init) => {
    request = {
      url: String(url),
      authorization: new Headers(init?.headers).get("Authorization"),
    };
    return new Response(
      JSON.stringify({ messages: [] }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const result = await client(new MemoryRepository(), {
      TWILIO_ACCOUNT_SID: "ACtest",
      TWILIO_API_KEY_SID: "SKlimited",
      TWILIO_API_KEY_SECRET: "restricted-secret",
    })("integrations/twilio/test");
    assert.equal(result.data.connected, true);
    assert.equal(
      request?.url,
      "https://api.twilio.com/2010-04-01/Accounts/ACtest/Messages.json?PageSize=1",
    );
    assert.equal(
      request?.authorization,
      "Basic " + btoa("SKlimited:restricted-secret"),
    );
    assert.equal(
      JSON.stringify(result.data).includes("restricted-secret"),
      false,
    );
  } finally {
    globalThis.fetch = original;
  }
});
