import test from "node:test";
import assert from "node:assert/strict";
import { configureElevenLabsTools } from "../src/elevenlabs-setup.ts";

const env = {
  ELEVENLABS_API_KEY: "private-key",
  ELEVENLABS_AGENT_ID: "agent-bound",
  ELEVENLABS_BRANCH_ID: "branch-main",
  ELEVENLABS_TOOL_SECRET_ID: "secret-reference",
  ELEVENLABS_TOOLS_API_ORIGIN: "https://ring-api.example",
  AGENT_MERCHANT_ID: "merchant-one",
};

test("tool setup preserves unrelated agent tools and prompt, uses references, and verifies attachment", async () => {
  const calls: { url: string; method: string; body?: any }[] = [];
  let ids = ["unrelated", "old-menu"];
  let created = 0;
  const fetcher: typeof fetch = async (url, init) => {
    const call = {
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    };
    calls.push(call);
    assert.equal(new Headers(init?.headers).get("xi-api-key"), "private-key");
    if (call.url.includes("/agents/")) {
      if (call.method === "PATCH") {
        assert.deepEqual(Object.keys(call.body.conversation_config.agent), ["prompt"]);
        assert.deepEqual(Object.keys(call.body.conversation_config.agent.prompt), ["tool_ids"]);
        ids = call.body.conversation_config.agent.prompt.tool_ids;
      }
      return Response.json({
        conversation_config: {
          agent: {
            first_message: "Hola, soy el asistente virtual",
            prompt: {
              prompt: "Existing working instructions",
              tool_ids: ids,
              tools: [{ type: "system", name: "end_call" }],
            },
          },
        },
      });
    }
    if (call.method === "GET")
      return Response.json({
        tools: [
          {
            id: "old-menu",
            tool_config: {
              name: "get_menu",
              api_schema: {
                url: "https://old-ring.example/api/tools/get_menu",
              },
            },
          },
        ],
        has_more: false,
      });
    assert.equal(
      call.body.tool_config.api_schema.request_headers.Authorization.secret_id,
      "secret-reference",
    );
    assert.deepEqual(call.body.tool_config.api_schema.path_params_schema, {});
    return Response.json({ id: `created-${++created}` });
  };
  const result = await configureElevenLabsTools(env, "merchant-one", fetcher);
  assert.ok(result.verified);
  assert.ok(created > 15);
  assert.ok(ids.includes("unrelated"));
  assert.ok(!ids.includes("old-menu"));
  assert.ok(
    calls
      .filter((c) => c.url.includes("/agents/"))
      .every((c) => c.url.includes("branch_id=branch-main")),
  );
  assert.ok(!JSON.stringify(result).includes("private-key"));
});

test("tool setup does not publish a partially configured agent after provider failure", async () => {
  let patched = false;
  const fetcher: typeof fetch = async (url, init) => {
    if (init?.method === "PATCH") patched = true;
    if (String(url).includes("/agents/"))
      return Response.json({
        conversation_config: { agent: { prompt: { tool_ids: [] } } },
      });
    if (init?.method === "POST")
      return Response.json({ detail: "not permitted" }, { status: 403 });
    return Response.json({ tools: [], has_more: false });
  };
  await assert.rejects(
    () => configureElevenLabsTools(env, "merchant-one", fetcher),
    /ElevenLabs.*403/,
  );
  assert.equal(patched, false);
  await assert.rejects(
    () => configureElevenLabsTools(env, "foreign", fetcher),
    /bound/,
  );
  await assert.rejects(
    () =>
      configureElevenLabsTools(
        { ...env, ELEVENLABS_TOOL_SECRET_ID: "" },
        "merchant-one",
        fetcher,
      ),
    /configuration/,
  );
});
