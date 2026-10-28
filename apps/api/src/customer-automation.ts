import { z } from "zod";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
import type { RuntimeEnv } from "./auth.ts";
import { HttpError, configuredAgentSecret } from "./auth.ts";
import { issueCustomerOrderLink } from "./customer-orders.ts";
import type { Session, TenantState } from "./types.ts";
import { issueCustomerCapabilityLink } from "./customer-capabilities.ts";
import type { CustomerCapabilityGrant } from "./customer-capabilities.ts";
import { issueCustomerVerificationChallenge } from "./customer-memory.ts";

export type AutomationPurpose =
  | "billing"
  | "receipt"
  | "recovery"
  | "verification";
export type AutomationStatus =
  | "QUEUED"
  | "CLAIMED"
  | "RETRY"
  | "SENT"
  | "FAILED"
  | "UNKNOWN"
  | "EXPIRED"
  | "CANCELLED";
export interface AutomationJob {
  id: string;
  order_id: string;
  purpose: AutomationPurpose;
  session_id?: string;
  consent_at: string;
  phone: string;
  encrypted_link: { version: 1; iv: string; ciphertext: string };
  grant_hash: string;
  expires_at: string;
  created_at: string;
  status: AutomationStatus;
  attempts: number;
  next_attempt_at: string;
  claim_token?: string;
  worker_id?: string;
  claim_expires_at?: string;
  provider_message_id?: string;
  last_outcome?: "sent" | "retryable_failure" | "permanent_failure" | "unknown";
  failure_reason?: "OUTBOX_DECRYPTION_FAILED";
}
export interface AutomationState {
  jobs: AutomationJob[];
  grants?: CustomerCapabilityGrant[];
}
type State = TenantState & { customer_automation?: AutomationState };
const id = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);
const queueSchema = z
  .object({
    order_id: id,
    purpose: z.enum(["billing", "receipt", "recovery"]),
    consent: z.literal(true),
  })
  .strict();
export type QueueAutomationInput = {
  order_id: string;
  purpose: Exclude<AutomationPurpose, "verification">;
  consent: boolean;
};
const claimSchema = z
  .object({ worker_id: id, limit: z.number().int().min(1).max(10).optional() })
  .strict();
export type ClaimAutomationInput = z.infer<typeof claimSchema>;
const ackSchema = z
  .object({
    job_id: id,
    claim_token: z.string().min(1).max(160),
    outcome: z.enum([
      "sent",
      "retryable_failure",
      "permanent_failure",
      "unknown",
    ]),
    provider_message_id: z.string().min(1).max(256).optional(),
  })
  .strict();
export type AckAutomationInput = z.infer<typeof ackSchema>;

const draftStatuses = new Set([
  "DRAFT",
  "AWAITING_CLARIFICATION",
  "AWAITING_CONFIRMATION",
]);
function canonicalOrder(state: TenantState, orderId: string) {
  const order = state.orders.find(
    (item) => item.id === orderId && item.merchant_id === state.merchant.id,
  );
  if (!order) throw new HttpError(404, "Order not found in your workspace.");
  return order;
}
function isDraft(order: Order) {
  return draftStatuses.has(order.status) && order.payment_status === "PENDING";
}
function phoneFor(order: Order) {
  const phone = (order.customer.phone ?? "").replace(/[\s().-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(phone))
    throw new HttpError(
      422,
      "A valid international customer phone is required.",
    );
  return phone;
}
const encode = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const decode = (text: string) =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
async function outboxKey(env: RuntimeEnv) {
  const secret = configuredAgentSecret(env);
  if (typeof secret !== "string" || secret.length < 16)
    throw new HttpError(
      503,
      "Customer automation requires a configured service secret.",
    );
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`ring-orden:customer-outbox:v1:${secret}`),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
function associatedData(
  state: TenantState,
  job: { id: string; purpose: AutomationPurpose },
) {
  return new TextEncoder().encode(
    `${state.merchant.id}:${job.id}:${job.purpose}`,
  );
}
async function encryptLink(
  state: State,
  job: { id: string; purpose: AutomationPurpose },
  link: string,
  env: RuntimeEnv,
): Promise<AutomationJob["encrypted_link"]> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(state, job) },
    await outboxKey(env),
    new TextEncoder().encode(link),
  );
  return {
    version: 1,
    iv: encode(iv),
    ciphertext: encode(new Uint8Array(ciphertext)),
  };
}
async function decryptLink(state: State, job: AutomationJob, env: RuntimeEnv) {
  const envelope = job.encrypted_link;
  if (envelope?.version !== 1)
    throw new Error("Unsupported outbox encryption version.");
  const plaintext = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: decode(envelope.iv),
      additionalData: associatedData(state, job),
    },
    await outboxKey(env),
    decode(envelope.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}

/** Mutates only the saved order's existing customer grant; never clones or rebuilds the order. */
export async function issueRecoveryLink(
  state: TenantState,
  order: Order,
  env: RuntimeEnv,
) {
  const saved = canonicalOrder(state, order.id);
  if (!isDraft(saved))
    throw new HttpError(
      409,
      "Recovery is available only for an unpaid saved draft.",
    );
  return issueCustomerOrderLink(state, saved, env, 600_000);
}

function summary(job: AutomationJob) {
  return {
    available: true,
    job_id: job.id,
    purpose: job.purpose,
    status: job.status,
    expires_at: job.expires_at,
  };
}

/** Mutates state. Persist successfully before returning success or dispatching externally. */
export async function queueCustomerAutomation(
  state: State,
  input: QueueAutomationInput,
  env: RuntimeEnv,
) {
  const body = queueSchema.parse(input);
  const order = canonicalOrder(state, body.order_id);
  const phone = phoneFor(order);
  if (body.purpose === "recovery" && !isDraft(order))
    throw new HttpError(
      409,
      "Recovery is available only for an unpaid saved draft.",
    );
  const existing = state.customer_automation?.jobs.find(
    (job) => job.order_id === order.id && job.purpose === body.purpose,
  );
  if (existing) return summary(existing);
  // Validate the key before issuing a grant; a missing service secret must not revoke working links.
  await outboxKey(env);
  const link =
    body.purpose === "recovery"
      ? await issueRecoveryLink(state, order, env)
      : await issueCustomerCapabilityLink(state, order, body.purpose, env);
  const now = new Date().toISOString();
  const jobId = `automation_${crypto.randomUUID()}`;
  const grantHash =
    body.purpose === "recovery"
      ? state.order_metadata[order.id].customer_link!.hash
      : state.customer_automation!.grants!.find(
          (grant) => "grant_id" in link && grant.id === link.grant_id,
        )!.hash;
  const job: AutomationJob = {
    id: jobId,
    order_id: order.id,
    purpose: body.purpose,
    consent_at: now,
    phone,
    encrypted_link: await encryptLink(
      state,
      { id: jobId, purpose: body.purpose },
      link.url,
      env,
    ),
    grant_hash: grantHash,
    expires_at: link.expires_at,
    created_at: now,
    status: "QUEUED",
    attempts: 0,
    next_attempt_at: now,
  };
  (state.customer_automation ??= { jobs: [] }).jobs.push(job);
  return summary(job);
}

/** Trusted voice ingress: explicit opt-in sends a challenge; the voice tool receives no bearer. */
export async function queueCustomerVerification(
  state: State,
  input: Session,
  consent: boolean,
  env: RuntimeEnv,
) {
  z.literal(true).parse(consent);
  const session = state.sessions.find(
    (item) => item.id === input.id && item.order_id === input.order_id,
  );
  if (!session) throw new HttpError(404, "Customer session not found.");
  const order = canonicalOrder(state, session.order_id);
  const phone = phoneFor(order);
  refreshJobs(state, Date.now());
  const existing = state.customer_automation?.jobs.find(
    (job) =>
      job.purpose === "verification" &&
      job.session_id === session.id &&
      job.order_id === order.id &&
      ["QUEUED", "CLAIMED", "RETRY", "SENT"].includes(job.status) &&
      Date.parse(job.expires_at) > Date.now() &&
      state.customer_memory?.challenges.some(
        (challenge) =>
          challenge.token_hash === job.grant_hash &&
          challenge.session_id === session.id &&
          !challenge.consumed_at &&
          Date.parse(challenge.expires_at) > Date.now(),
      ),
  );
  if (existing) return summary(existing);
  await outboxKey(env);
  const challenge = await issueCustomerVerificationChallenge(
    state,
    session,
    env,
  );
  const grant = state.customer_memory!.challenges.find(
    (item) => item.id === challenge.challenge_id,
  )!;
  const jobId = `automation_${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const job: AutomationJob = {
    id: jobId,
    order_id: order.id,
    session_id: session.id,
    purpose: "verification",
    consent_at: now,
    phone,
    encrypted_link: await encryptLink(
      state,
      { id: jobId, purpose: "verification" },
      challenge.url,
      env,
    ),
    grant_hash: grant.token_hash,
    expires_at: challenge.expires_at,
    created_at: now,
    status: "QUEUED",
    attempts: 0,
    next_attempt_at: now,
  };
  (state.customer_automation ??= { jobs: [] }).jobs.push(job);
  return summary(job);
}

function refreshJobs(state: State, now: number) {
  for (const job of state.customer_automation?.jobs ?? []) {
    if (!["QUEUED", "RETRY", "CLAIMED"].includes(job.status)) continue;
    // A lost acknowledgement cannot establish non-delivery. Never reclaim for a blind resend.
    if (
      job.status === "CLAIMED" &&
      Date.parse(job.claim_expires_at ?? "") <= now
    ) {
      job.status = "UNKNOWN";
      continue;
    }
    if (Date.parse(job.expires_at) <= now) {
      job.status = "EXPIRED";
      continue;
    }
    const order = state.orders.find(
      (item) =>
        item.id === job.order_id && item.merchant_id === state.merchant.id,
    );
    const challenge =
      job.purpose === "verification"
        ? state.customer_memory?.challenges.find(
            (item) =>
              item.token_hash === job.grant_hash &&
              item.session_id === job.session_id &&
              !item.consumed_at,
          )
        : undefined;
    const grant =
      job.purpose === "verification"
        ? challenge
          ? { hash: challenge.token_hash, expires_at: challenge.expires_at }
          : undefined
        : job.purpose === "recovery"
          ? state.order_metadata[job.order_id]?.customer_link
          : state.customer_automation?.grants?.find(
              (item) =>
                item.order_id === job.order_id &&
                item.purpose === job.purpose &&
                item.hash === job.grant_hash &&
                !item.revoked_at,
            );
    if (
      !order ||
      (job.purpose === "recovery" && !isDraft(order)) ||
      order.customer.phone?.replace(/[\s().-]/g, "") !== job.phone ||
      grant?.hash !== job.grant_hash ||
      grant.expires_at !== job.expires_at
    )
      job.status = "CANCELLED";
  }
}

/** Mutates claim/expiry state. CAS persistence is required BEFORE returning jobs to n8n. */
export async function claimAutomationJobs(
  state: State,
  input: ClaimAutomationInput,
  env: RuntimeEnv,
) {
  const body = claimSchema.parse(input);
  const now = Date.now();
  refreshJobs(state, now);
  const jobs = (state.customer_automation?.jobs ?? [])
    .filter(
      (job) =>
        ["QUEUED", "RETRY"].includes(job.status) &&
        Date.parse(job.next_attempt_at) <= now &&
        job.attempts < 3,
    )
    .slice(0, body.limit ?? 10);
  const claims = [];
  for (const job of jobs) {
    let link: string;
    try {
      link = await decryptLink(state, job, env);
    } catch {
      job.status = "FAILED";
      job.failure_reason = "OUTBOX_DECRYPTION_FAILED";
      continue;
    }
    job.status = "CLAIMED";
    job.attempts++;
    job.claim_token = crypto.randomUUID();
    job.worker_id = body.worker_id;
    job.claim_expires_at = new Date(
      Math.min(now + 120_000, Date.parse(job.expires_at)),
    ).toISOString();
    delete job.last_outcome;
    const message =
      job.purpose === "recovery"
        ? `Puedes continuar tu pedido guardado hasta ${job.expires_at}: ${link}`
        : job.purpose === "receipt"
          ? `Consulta el resumen y estado de tu pedido: ${link}`
          : job.purpose === "verification"
            ? `Verifica tu contacto para esta llamada mediante este enlace seguro: ${link}`
            : `Completa tus datos de facturación en este enlace seguro: ${link}`;
    claims.push({
      job_id: job.id,
      claim_token: job.claim_token,
      idempotency_key: job.id,
      phone: job.phone,
      purpose: job.purpose,
      expires_at: job.expires_at,
      url: link,
      message,
    });
  }
  return { jobs: claims };
}

/** Mutates acknowledgement state. "sent" means provider accepted, never delivered. */
export function ackAutomationJob(state: State, input: AckAutomationInput) {
  const body = ackSchema.parse(input);
  const job = state.customer_automation?.jobs.find(
    (item) => item.id === body.job_id,
  );
  if (!job) throw new HttpError(404, "Automation job not found.");
  if (job.claim_token !== body.claim_token)
    throw new HttpError(409, "Automation claim does not match.");
  if (
    job.last_outcome === body.outcome &&
    job.provider_message_id === body.provider_message_id
  )
    return summary(job);
  if (
    job.status !== "CLAIMED" &&
    !(job.status === "UNKNOWN" && body.outcome === "sent")
  )
    throw new HttpError(409, "Automation claim is no longer active.");
  if (body.outcome === "sent" && !body.provider_message_id)
    throw new HttpError(
      422,
      "Provider acceptance requires a provider message identifier.",
    );
  job.last_outcome = body.outcome;
  if (body.outcome === "sent") {
    job.status = "SENT";
    job.provider_message_id = body.provider_message_id;
  } else if (body.outcome === "unknown") job.status = "UNKNOWN";
  else if (body.outcome === "permanent_failure" || job.attempts >= 3)
    job.status = "FAILED";
  else {
    const next = Date.now() + 30_000 * 2 ** (job.attempts - 1);
    job.status = next < Date.parse(job.expires_at) ? "RETRY" : "EXPIRED";
    job.next_attempt_at = new Date(next).toISOString();
  }
  return summary(job);
}

/** Recognized tools mutate state; unknown tools return undefined without mutation. */
export async function handleAutomationTool(
  state: State,
  tool: string,
  body: Record<string, unknown>,
  env: RuntimeEnv,
  session?: Session,
): Promise<Record<string, unknown> | undefined> {
  if (tool === "claim_automation_jobs")
    return claimAutomationJobs(state, body as ClaimAutomationInput, env);
  if (tool === "ack_automation_job")
    return ackAutomationJob(state, body as AckAutomationInput);
  if (tool !== "customer_followup") return undefined;
  const input = z
    .object({
      session_id: id,
      purpose: z.enum(["billing", "receipt", "recovery"]),
      consent: z.literal(true),
    })
    .strict()
    .parse(body);
  const savedSession = state.sessions.find(
    (item) => item.id === input.session_id,
  );
  if (!savedSession || (session && session.id !== savedSession.id))
    throw new HttpError(404, "Customer session not found.");
  return queueCustomerAutomation(
    state,
    { order_id: savedSession.order_id, purpose: input.purpose, consent: true },
    env,
  );
}
