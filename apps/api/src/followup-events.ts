import { z } from "zod";
import { HttpError } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { Repository, Session, TenantState } from "./types.ts";
import { queueCustomerAutomation } from "./customer-automation.ts";

interface FollowupConsent {
  session_id: string;
  purpose: "receipt" | "recovery";
  consent: boolean;
  recorded_at: string;
  status?: string;
}
type FollowupState = TenantState & {
  followup_consents?: Record<
    string,
    Partial<Record<"receipt" | "recovery", FollowupConsent>>
  >;
  ended_conversations?: string[];
};
const consentSchema = z
  .object({
    purpose: z.enum(["receipt", "recovery"]),
    consent: z.boolean(),
    utterance: z.string().trim().min(1).max(500),
  })
  .strict();

/** Authenticated voice records the customer's actual consent; it does not send anything. */
export function saveFollowupConsent(
  state: FollowupState,
  session: Session,
  input: unknown,
) {
  const body = consentSchema.parse(input);
  if (
    !state.sessions.includes(session) ||
    !state.orders.some(
      (o) => o.id === session.order_id && o.merchant_id === state.merchant.id,
    )
  )
    throw new HttpError(404, "Conversation not found in this workspace.");
  const consent: FollowupConsent = {
    session_id: session.id,
    purpose: body.purpose,
    consent: body.consent,
    recorded_at: new Date().toISOString(),
  };
  ((state.followup_consents ??= {})[session.order_id] ??= {})[body.purpose] =
    consent;
  if (!body.consent)
    for (const job of state.customer_automation?.jobs ?? [])
      if (
        job.order_id === session.order_id &&
        job.purpose === body.purpose &&
        ["QUEUED", "RETRY"].includes(job.status)
      )
        job.status = "CANCELLED";
  return {
    saved: true,
    purpose: body.purpose,
    consent: body.consent,
    notification_status: body.consent ? "SCHEDULED" : "CANCELLED",
  };
}

/** Only persisted receipt consent can materialize a completed-order job. Never block order completion. */
export async function queueCompletedReceipts(
  state: FollowupState,
  env: RuntimeEnv,
) {
  for (const [orderId, purposes] of Object.entries(
    state.followup_consents ?? {},
  ).slice(-100)) {
    const consent = purposes.receipt;
    if (!consent?.consent || consent.status === "QUEUED") continue;
    const order = state.orders.find(
      (o) => o.id === orderId && o.merchant_id === state.merchant.id,
    );
    if (order?.status !== "COMPLETED") continue;
    try {
      await queueCustomerAutomation(
        state,
        { order_id: orderId, purpose: "receipt", consent: true },
        env,
      );
      consent.status = "QUEUED";
    } catch {
      consent.status = "CONFIGURATION_REQUIRED";
    }
  }
}

async function signedPayload(request: Request, env: RuntimeEnv) {
  const secret = String(env.ELEVENLABS_WEBHOOK_SECRET ?? "");
  if (secret.length < 16)
    throw new HttpError(503, "ElevenLabs webhook signing is not configured.");
  const parts = (request.headers.get("ElevenLabs-Signature") ?? "")
    .split(",")
    .map((p) => p.trim().split("="));
  const times = parts.filter((p) => p[0] === "t");
  const signatures = parts.filter((p) => p[0] === "v0").map((p) => p[1]);
  const timestamp = times[0]?.[1];
  const seconds = Number(timestamp);
  if (
    times.length !== 1 ||
    !/^\d{1,12}$/.test(timestamp ?? "") ||
    !Number.isSafeInteger(seconds) ||
    seconds < Date.now() / 1000 - 300 ||
    seconds > Date.now() / 1000 + 60
  )
    throw new HttpError(401, "Invalid ElevenLabs signature.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "Webhook body is required.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    length += chunk.value.length;
    if (length > 128 * 1024) {
      await reader.cancel();
      throw new HttpError(413, "Webhook body is too large.");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const raw = new TextDecoder().decode(bytes);
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${timestamp}.${raw}`),
  );
  const expected = Array.from(new Uint8Array(mac), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  let matched = false;
  for (const signature of signatures) {
    if (!/^[a-fA-F0-9]{64}$/.test(signature ?? "")) continue;
    let difference = 0;
    for (let i = 0; i < 64; i++)
      difference |=
        expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
    matched ||= difference === 0;
  }
  if (!matched) throw new HttpError(401, "Invalid ElevenLabs signature.");
  try {
    return JSON.parse(raw) as Record<string, any>;
  } catch {
    throw new HttpError(400, "Invalid webhook JSON.");
  }
}

/** Provider-signed end-of-call signal. Conversation text/audio is never persisted here. */
export async function handleElevenLabsEvent(
  request: Request,
  env: RuntimeEnv,
  repo: Repository,
): Promise<Response> {
  const reply = (body: unknown, status = 200) =>
    Response.json(body, {
      status,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  try {
    const event = await signedPayload(request, env);
    if (!env.AGENT_MERCHANT_ID || !env.ELEVENLABS_AGENT_ID)
      throw new HttpError(
        503,
        "ElevenLabs merchant binding is not configured.",
      );
    if (event.data?.agent_id !== env.ELEVENLABS_AGENT_ID)
      throw new HttpError(403, "Agent binding does not match.");
    if (event.type !== "post_call_transcription")
      return reply({ received: true, ignored: true });
    const conversation = z
      .string()
      .min(1)
      .max(200)
      .parse(event.data.conversation_id);
    const stored = await repo.loadByMerchant(env.AGENT_MERCHANT_ID);
    if (!stored) throw new HttpError(404, "Merchant not found.");
    const state = stored.state as FollowupState;
    if (state.ended_conversations?.includes(conversation))
      return reply({ received: true, duplicate: true });
    const session = state.sessions.find(
      (s) => s.provider_conversation_id === conversation,
    );
    if (!session)
      return reply({
        received: true,
        ignored: true,
        reason: "unbound_conversation",
      });
    const order = state.orders.find(
      (o) => o.id === session.order_id && o.merchant_id === state.merchant.id,
    );
    const consent = state.followup_consents?.[session.order_id]?.recovery;
    const metadata = event.data.metadata;
    const end =
      Number(metadata?.start_time_unix_secs) +
      Number(metadata?.call_duration_secs);
    const endedAt =
      Number.isFinite(end) && end > 0 ? end : Number(event.event_timestamp);
    const expiry = endedAt * 1000 + 600000;
    let queued = false;
    if (
      order?.items.length &&
      ["DRAFT", "AWAITING_CLARIFICATION", "AWAITING_CONFIRMATION"].includes(
        order.status,
      ) &&
      consent?.consent &&
      consent.session_id === session.id &&
      Number.isFinite(expiry) &&
      expiry > Date.now() &&
      endedAt <= Date.now() / 1000 + 60
    ) {
      const result = await queueCustomerAutomation(
        state,
        { order_id: order.id, purpose: "recovery", consent: true },
        env,
      );
      const job = state.customer_automation?.jobs.find(
        (j) => j.id === result.job_id,
      );
      if (job) {
        job.expires_at = new Date(
          Math.min(expiry, Date.parse(job.expires_at)),
        ).toISOString();
        const grant = state.order_metadata[order.id]?.customer_link;
        if (grant) grant.expires_at = job.expires_at;
        queued = true;
      }
    }
    state.ended_conversations = [
      ...(state.ended_conversations ?? []),
      conversation,
    ].slice(-2000);
    session.status = order?.status === "COMPLETED" ? "COMPLETED" : "ENDED";
    await queueCompletedReceipts(state, env);
    if (!(await repo.saveTrusted(state.merchant.id, stored.revision, state)))
      throw new HttpError(409, "Another update arrived. Retry this event.");
    return reply({ received: true, recovery_queued: queued });
  } catch (error) {
    return reply(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "Invalid ElevenLabs event.",
      },
      error instanceof HttpError ? error.status : 422,
    );
  }
}
