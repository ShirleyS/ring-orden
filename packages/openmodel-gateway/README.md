# OpenModel Gateway

MIT provider-neutral transaction interpretation with strict JSON and canonical-operation validation. DeepSeek defaults to `deepseek-flash`, verified against the official Chat Completions documentation on 2026-10-27. DeepSeek credentials are never sent to the browser.

```ts
import { DeepSeekAdapter, Gateway, runCompatibilityTest } from './src/index.ts';
const primary = new DeepSeekAdapter({apiKey: process.env.DEEPSEEK_API_KEY!});
const result = await new Gateway(primary).interpret({utterance, order, catalog, memories});
const report = await runCompatibilityTest(primary);
```

Generic OpenAI-compatible adapter options: `{provider, endpoint, model, apiKey?, timeoutMs?, headers?, jsonSchema?, allowLocalhost?}`. Provider labels include DeepSeek, Qwen, Ollama, vLLM, SGLang and generic. This is an endpoint abstraction, **not a claim that all models passed compatibility**. Run the 10-case compatibility test against the actual endpoint/model before selecting it. Capabilities remain unverified until tested. The adapter implements non-streaming structured output; other server capabilities are not advertised.

Remote endpoints require HTTPS. Literal private/link-local destinations and local hostnames are rejected in hosted mode; redirects are never followed, and provider response JSON is capped at 1 MiB. Local HTTP endpoints require explicit `allowLocalhost:true` and localhost/127.0.0.1; never enable it for untrusted hosted tenant configuration. Credentials/headers are server-only. Deployments should additionally restrict outbound destinations for untrusted custom endpoints.

The adapter retries once, including one strict JSON repair attempt. Each attempt has a 500–30,000 ms bounded timeout (8,000 ms default). Confirmation is isolated: no model-proposed cart changes may accompany customer consent. Gateway fallback happens only when `allowFallback:true` and a fallback adapter is supplied; every use is exposed through `onFallback`. The application must persist these events. Disabling fallback prevents external fallback requests.

`interpretDemo` is a deterministic multilingual demonstration parser, intentionally labeled separately from a real model. It handles the difficult latte-reference script, ambiguity, correction evidence, Spanish, English and Spanglish. It does not impersonate a live LLM. `isExplicitConfirmation` must guard model-proposed confirmation in the API.

```sh
node --experimental-strip-types --test packages/openmodel-gateway/tests/*.test.ts
node --experimental-strip-types packages/openmodel-gateway/evals/run.ts
```

`evals/latest-demo-results.json` records actual deterministic parser results. The live-model benchmark is explicitly unrun when no credentials are available. Never present deterministic scores as a DeepSeek/Qwen/Ollama benchmark.

Official reference: https://api-docs.deepseek.com/api/create-chat-completion/
