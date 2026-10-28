import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createOrder } from "../../../packages/ring-orden-core/src/index.ts";
import { seedTenant } from "../src/seed.ts";
import { issueCustomerOrderLink } from "../src/customer-orders.ts";
import {
  issueRecoveryLink,
  queueCustomerAutomation,
  claimAutomationJobs,
  ackAutomationJob,
  handleAutomationTool,
  queueCustomerVerification,
} from "../src/customer-automation.ts";
import type { AutomationState } from "../src/customer-automation.ts";
import type { TenantState } from "../src/types.ts";
import { completeCustomerVerification } from "../src/customer-memory.ts";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import { handlePublicIngress } from "../../../netlify/ingress.ts";

const env = {
  CUSTOMER_APP_ORIGIN: "https://order.example",
  AGENT_TOOL_SECRET: "test-automation-secret-32-characters",
};
function fixture() {
  const state = seedTenant(
    "merchant_test",
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      provider: "sites",
    },
    false,
  ) as TenantState & { customer_automation?: AutomationState };
  const order = createOrder(state.merchant.id, "order_recovery");
  order.customer = { name: "Ana", phone: "+525555550123" };
  state.orders.push(order);
  state.sessions.push({
    id: "session_test",
    order_id: order.id,
    turns: [],
    created_at: new Date().toISOString(),
    status: "ACTIVE",
    pending_corrections: [],
  });
  return { state, order };
}

test("recovery uses the exact saved draft and expires in exactly ten minutes; normal grants retain one hour", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const { state, order } = fixture();
  const before = JSON.stringify(order);
  const link = await issueRecoveryLink(
    state,
    { ...order, customer: { name: "Forged", phone: "+12025550199" } },
    env,
  );
  assert.equal(Date.parse(link.expires_at) - Date.now(), 600_000);
  assert.equal(JSON.stringify(order), before);
  assert.equal(state.orders.length, 1);
  const token = JSON.parse(
    Buffer.from(new URL(link.url).hash.slice(1), "base64url").toString(),
  );
  assert.equal(token.order_id, order.id);
  const standard = await issueCustomerOrderLink(state, order, env);
  assert.equal(Date.parse(standard.expires_at) - Date.now(), 3_600_000);
});

test("recovery requires explicit consent, valid customer phone and an unpaid draft", async () => {
  const { state, order } = fixture();
  await assert.rejects(
    queueCustomerAutomation(
      state,
      { order_id: order.id, purpose: "recovery", consent: false },
      env,
    ),
  );
  assert.equal(state.customer_automation, undefined);
  order.customer.phone = "";
  await assert.rejects(
    queueCustomerAutomation(
      state,
      { order_id: order.id, purpose: "recovery", consent: true },
      env,
    ),
    /phone/i,
  );
  order.customer.phone = "+525555550123";
  order.status = "COMPLETED";
  await assert.rejects(
    queueCustomerAutomation(
      state,
      { order_id: order.id, purpose: "recovery", consent: true },
      env,
    ),
    /draft/i,
  );
  assert.equal(state.order_metadata[order.id]?.customer_link, undefined);
});

test("queue is durable and idempotent and claims cannot be duplicated", async () => {
  const { state, order } = fixture();
  const input = {
    order_id: order.id,
    purpose: "recovery" as const,
    consent: true as const,
  };
  const first = await queueCustomerAutomation(state, input, env);
  const duplicate = await queueCustomerAutomation(state, input, env);
  assert.equal(first.job_id, duplicate.job_id);
  assert.equal(state.customer_automation!.jobs.length, 1);
  const restored = JSON.parse(JSON.stringify(state));
  assert.equal(
    JSON.stringify(restored).includes("/order#"),
    false,
    "raw capability must not persist in outbox",
  );
  const claimed = await claimAutomationJobs(
    restored,
    { worker_id: "n8n-one" },
    env,
  );
  assert.equal(claimed.jobs.length, 1);
  assert.equal(claimed.jobs[0].idempotency_key, first.job_id);
  assert.equal(
    (await claimAutomationJobs(restored, { worker_id: "n8n-two" }, env)).jobs
      .length,
    0,
  );
  assert.throws(
    () =>
      ackAutomationJob(restored, {
        job_id: first.job_id,
        claim_token: "wrong",
        outcome: "sent",
        provider_message_id: "wamid.1",
      }),
    /claim/i,
  );
  const ack = {
    job_id: first.job_id,
    claim_token: claimed.jobs[0].claim_token,
    outcome: "sent" as const,
    provider_message_id: "wamid.1",
  };
  assert.equal(ackAutomationJob(restored, ack).status, "SENT");
  assert.equal(ackAutomationJob(restored, ack).status, "SENT");
  assert.equal(
    (await claimAutomationJobs(restored, { worker_id: "n8n-two" }, env)).jobs
      .length,
    0,
  );
});

test("only known non-delivery retries with backoff; timeout becomes unknown with no automatic resend", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const { state, order } = fixture();
  const job = await queueCustomerAutomation(
    state,
    { order_id: order.id, purpose: "recovery", consent: true },
    env,
  );
  const claim = (await claimAutomationJobs(state, { worker_id: "n8n" }, env))
    .jobs[0];
  ackAutomationJob(state, {
    job_id: job.job_id,
    claim_token: claim.claim_token,
    outcome: "retryable_failure",
  });
  assert.equal(
    (await claimAutomationJobs(state, { worker_id: "n8n" }, env)).jobs.length,
    0,
  );
  t.mock.timers.tick(30_000);
  assert.equal(
    (await claimAutomationJobs(state, { worker_id: "n8n" }, env)).jobs.length,
    1,
  );
  t.mock.timers.tick(120_000);
  assert.equal(
    (await claimAutomationJobs(state, { worker_id: "n8n" }, env)).jobs.length,
    0,
  );
  assert.equal(state.customer_automation!.jobs[0].status, "UNKNOWN");
});

test("expired jobs and changed or revoked grants are never sent", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const first = fixture();
  await queueCustomerAutomation(
    first.state,
    { order_id: first.order.id, purpose: "recovery", consent: true },
    env,
  );
  t.mock.timers.tick(600_000);
  assert.equal(
    (await claimAutomationJobs(first.state, { worker_id: "n8n" }, env)).jobs
      .length,
    0,
  );
  assert.equal(first.state.customer_automation!.jobs[0].status, "EXPIRED");
  const second = fixture();
  await queueCustomerAutomation(
    second.state,
    { order_id: second.order.id, purpose: "recovery", consent: true },
    env,
  );
  delete second.state.order_metadata[second.order.id].customer_link;
  assert.equal(
    (await claimAutomationJobs(second.state, { worker_id: "n8n" }, env)).jobs
      .length,
    0,
  );
  assert.equal(second.state.customer_automation!.jobs[0].status, "CANCELLED");
});

test("voice followup is session bound; completed receipt and billing use dedicated grants", async () => {
  const { state, order } = fixture();
  for (const purpose of ["receipt", "billing"]) {
    const response = await handleAutomationTool(
      state,
      "customer_followup",
      { session_id: "session_test", purpose, consent: true },
      env,
      state.sessions[0],
    );
    assert.equal(response?.available, true);
    assert.equal(state.order_metadata[order.id]?.customer_link, undefined);
  }
  await assert.rejects(
    handleAutomationTool(
      state,
      "customer_followup",
      { session_id: "different_session", purpose: "recovery", consent: true },
      env,
      state.sessions[0],
    ),
    /session/i,
  );
  assert.equal(
    await handleAutomationTool(state, "unknown", {}, env),
    undefined,
  );
  const result = await handleAutomationTool(
    state,
    "customer_followup",
    { session_id: "session_test", purpose: "recovery", consent: true },
    env,
    state.sessions[0],
  );
  assert.equal(result?.status, "QUEUED");
  assert.equal(JSON.stringify(result).includes("+525555550123"), false);
});

test("outbox encryption failure blocks dispatch and does not claim delivery", async () => {
  const { state, order } = fixture();
  await queueCustomerAutomation(
    state,
    { order_id: order.id, purpose: "recovery", consent: true },
    env,
  );
  const claimed = await claimAutomationJobs(
    state,
    { worker_id: "n8n" },
    { ...env, AGENT_TOOL_SECRET: "rotated-automation-secret-32-characters" },
  );
  assert.equal(claimed.jobs.length, 0);
  assert.equal(state.customer_automation!.jobs[0].status, "FAILED");
  assert.equal(
    state.customer_automation!.jobs[0].failure_reason,
    "OUTBOX_DECRYPTION_FAILED",
  );
});

test("n8n dispatch workflow requires provider evidence and never retries an ambiguous send", () => {
  const workflow = JSON.parse(
    readFileSync(
      new URL("../../../n8n/i-customer-automation.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(workflow.active, false);
  const provider = workflow.nodes.find(
    (node: any) => node.name === "WhatsApp provider send",
  );
  assert.notEqual(provider.retryOnFail, true);
  assert.ok(provider.credentials.httpHeaderAuth);
  const claimNode = workflow.nodes.find(
    (node: any) => node.name === "Claim backend jobs",
  );
  const ackNode = workflow.nodes.find(
    (node: any) => node.name === "Acknowledge backend job",
  );
  assert.match(
    claimNode.parameters.url,
    /\/api\/automation\/claim_automation_jobs/,
  );
  assert.match(ackNode.parameters.url, /\/api\/automation\/ack_automation_job/);
  const classify = workflow.nodes.find(
    (node: any) => node.name === "Classify provider evidence",
  );
  const execute = (response: unknown) =>
    new Function("$input", "$", classify.parameters.jsCode)(
      { item: { json: response } },
      () => ({ item: { json: { job_id: "job_1", claim_token: "claim_1" } } }),
    ).json;
  assert.equal(
    execute({ statusCode: 200, body: { messages: [{ id: "wamid.123" }] } })
      .outcome,
    "sent",
  );
  assert.equal(
    execute({ statusCode: 200, body: { success: true } }).outcome,
    "unknown",
  );
  assert.equal(execute({ statusCode: 500, body: {} }).outcome, "unknown");
  assert.equal(execute({ error: "timeout" }).outcome, "unknown");
  assert.equal(
    execute({ statusCode: 429, body: {} }).outcome,
    "retryable_failure",
  );
  assert.equal(
    execute({ statusCode: 400, body: {} }).outcome,
    "permanent_failure",
  );
  assert.notEqual(
    execute({
      statusCode: 201,
      body: { sid: "SM123", status: "failed", error_code: 30003 },
    }).outcome,
    "sent",
  );
  assert.notEqual(
    execute({
      statusCode: 200,
      body: { messages: [{ id: "wamid.123", message_status: "failed" }] },
    }).outcome,
    "sent",
  );
  const deadline = workflow.nodes.find(
    (node: any) => node.name === "Check dispatch deadline",
  );
  const guard = new Function("$input", deadline.parameters.jsCode);
  assert.throws(
    () =>
      guard({
        item: { json: { expires_at: new Date(Date.now() - 1).toISOString() } },
      }),
    /expired/i,
  );
  assert.throws(
    () => guard({ item: { json: { expires_at: "invalid" } } }),
    /expired/i,
  );
  assert.equal(
    guard({
      item: {
        json: { expires_at: new Date(Date.now() + 60_000).toISOString() },
      },
    }).json.expires_at.length > 0,
    true,
  );
});

test("verification notification hides bearer token from voice and binds to the exact saved session", async () => {
  const { state } = fixture();
  const session = state.sessions[0];
  await assert.rejects(queueCustomerVerification(state, session, false, env));
  const queued = await queueCustomerVerification(state, session, true, env);
  assert.equal(queued.status, "QUEUED");
  assert.equal("token" in queued, false);
  assert.equal("url" in queued, false);
  assert.equal(JSON.stringify(state).includes("#"), false);
  assert.equal(
    (await queueCustomerVerification(state, session, true, env)).job_id,
    queued.job_id,
  );
  const claimed = (await claimAutomationJobs(state, { worker_id: "n8n" }, env))
    .jobs[0];
  assert.equal(claimed.purpose, "verification");
  const link = claimed.message.match(/https:\/\/\S+$/)![0];
  assert.equal(new URL(link).searchParams.get("purpose"), "verify");
  const verified = await completeCustomerVerification(
    state,
    new URL(link).hash.slice(1),
  );
  assert.equal(verified.verified, true);
});

test("verification can be explicitly requested again after challenge expiry without reusing the old job", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const { state } = fixture();
  const first = await queueCustomerVerification(
    state,
    state.sessions[0],
    true,
    env,
  );
  assert.equal(
    (await queueCustomerVerification(state, state.sessions[0], true, env))
      .job_id,
    first.job_id,
  );
  t.mock.timers.tick(600_000);
  const renewed = await queueCustomerVerification(
    state,
    state.sessions[0],
    true,
    env,
  );
  assert.notEqual(renewed.job_id, first.job_id);
  assert.equal(state.customer_automation!.jobs[0].status, "EXPIRED");
  assert.equal(state.customer_memory!.challenges.length, 2);
  assert.equal(Date.parse(renewed.expires_at) - Date.now(), 600_000);
});

test("a consumed or unknown verification challenge can be replaced only by a fresh explicit request", async () => {
  const { state } = fixture();
  const first = await queueCustomerVerification(
    state,
    state.sessions[0],
    true,
    env,
  );
  const claimed = (await claimAutomationJobs(state, { worker_id: "n8n" }, env))
    .jobs[0];
  ackAutomationJob(state, {
    job_id: claimed.job_id,
    claim_token: claimed.claim_token,
    outcome: "unknown",
  });
  assert.equal(
    (await claimAutomationJobs(state, { worker_id: "n8n" }, env)).jobs.length,
    0,
    "uncertain provider outcome never retries automatically",
  );
  await assert.rejects(
    queueCustomerVerification(state, state.sessions[0], false, env),
  );
  assert.equal(state.customer_automation!.jobs.length, 1);
  const renewed = await queueCustomerVerification(
    state,
    state.sessions[0],
    true,
    env,
  );
  assert.notEqual(renewed.job_id, first.job_id);
  assert.equal(
    state.customer_automation!.jobs[0].status,
    "UNKNOWN",
    "retain uncertain send evidence for reconciliation",
  );
  assert.ok(
    state.customer_memory!.challenges[0].consumed_at,
    "superseded challenge is unusable",
  );
  const nextClaim = (
    await claimAutomationJobs(state, { worker_id: "n8n" }, env)
  ).jobs[0];
  const token = new URL(
    nextClaim.message.match(/https:\/\/\S+$/)![0],
  ).hash.slice(1);
  await completeCustomerVerification(state, token);
  const afterConsumed = await queueCustomerVerification(
    state,
    state.sessions[0],
    true,
    env,
  );
  assert.notEqual(afterConsumed.job_id, renewed.job_id);
});

async function handlerFixture() {
  const { state, order } = fixture();
  const repo = new MemoryRepository();
  await repo.create(state.merchant.id, "owner", state);
  const apiEnv = {
    ...env,
    AGENT_MERCHANT_ID: state.merchant.id,
    TRUST_SITES_HEADERS: "true",
  };
  const call = async (tool: string, body: unknown, authorized = true) => {
    const response = await handleRequest(
      new Request(`https://api.example/api/tools/${tool}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(authorized
            ? { Authorization: `Bearer ${env.AGENT_TOOL_SECRET}` }
            : {}),
        },
        body: JSON.stringify(body),
      }),
      apiEnv,
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  const queued = await call("customer_followup", {
    session_id: state.sessions[0].id,
    purpose: "recovery",
    consent: true,
  });
  assert.equal(queued.status, 200, JSON.stringify(queued.data));
  return { state, order, repo, call, queued };
}

test("public tool handler persists a single winning claim and rejects unauthenticated workers", async () => {
  const f = await handlerFixture();
  assert.equal(
    (
      await f.call(
        "claim_automation_jobs",
        { worker_id: "unauthorized" },
        false,
      )
    ).status,
    401,
  );
  const responses = await Promise.all([
    f.call("claim_automation_jobs", { worker_id: "worker_one" }),
    f.call("claim_automation_jobs", { worker_id: "worker_two" }),
  ]);
  assert.ok(
    responses.every((response) => [200, 409].includes(response.status)),
  );
  const claims = responses
    .filter((response) => response.status === 200)
    .flatMap((response) => response.data.jobs);
  assert.equal(claims.length, 1);
  const row = (await f.repo.loadByMerchant(f.state.merchant.id))!;
  assert.equal(
    row.state.customer_automation!.jobs[0].claim_token,
    claims[0].claim_token,
  );
  assert.equal(row.state.customer_automation!.jobs[0].attempts, 1);
  const ack = {
    job_id: claims[0].job_id,
    claim_token: claims[0].claim_token,
    outcome: "sent",
    provider_message_id: "wamid.test",
  };
  assert.equal((await f.call("ack_automation_job", ack)).data.status, "SENT");
  assert.equal((await f.call("ack_automation_job", ack)).data.status, "SENT");
});

test("a failed claim save returns no dispatch payload and leaves the durable job queued", async () => {
  const f = await handlerFixture();
  f.repo.saveTrusted = async () => false;
  const response = await f.call("claim_automation_jobs", {
    worker_id: "worker",
  });
  assert.equal(response.status, 409);
  assert.equal("jobs" in response.data, false);
  assert.equal(
    (await f.repo.loadByMerchant(f.state.merchant.id))!.state
      .customer_automation!.jobs[0].status,
    "QUEUED",
  );
});

test("public ingress restricts worker claims and acknowledgements to the automation namespace", async () => {
  const f = await handlerFixture();
  const publicEnv = {
    ...env,
    AGENT_MERCHANT_ID: f.state.merchant.id,
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVER_SECRET: "test-server-secret",
  };
  const call = async (path: string, body: unknown) =>
    handlePublicIngress(
      new Request(`https://api.example${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.AGENT_TOOL_SECRET}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      publicEnv,
      f.repo,
    );
  assert.equal(
    (await call("/api/tools/claim_automation_jobs", { worker_id: "n8n" }))
      .status,
    404,
  );
  assert.equal((await call("/api/tools/ack_automation_job", {})).status, 404);
  const response = await call("/api/automation/claim_automation_jobs", {
    worker_id: "n8n",
  });
  assert.equal(response.status, 200);
  const claimed = ((await response.json()) as any).jobs[0];
  assert.equal(
    (
      await call("/api/automation/ack_automation_job", {
        job_id: claimed.job_id,
        claim_token: claimed.claim_token,
        outcome: "unknown",
      })
    ).status,
    200,
  );
});
