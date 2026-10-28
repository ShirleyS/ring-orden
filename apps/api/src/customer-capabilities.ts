import { z } from "zod";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
import { HttpError, sha256Hex } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { Repository, TenantState } from "./types.ts";
import type { AutomationState } from "./customer-automation.ts";
import {
  customerIdForOrder,
  saveCustomerBillingProfile,
} from "./customer-memory.ts";

export type CustomerCapabilityPurpose = "receipt" | "billing";
export interface CustomerCapabilityGrant {
  id: string;
  order_id: string;
  purpose: CustomerCapabilityPurpose;
  hash: string;
  expires_at: string;
  revoked_at?: string;
  used_at?: string;
  submission_hash?: string;
}
type State = TenantState & { customer_automation?: AutomationState };
const routingId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_-]+$/);
const envelopeSchema = z
  .object({
    merchant_id: routingId,
    order_id: routingId,
    grant_id: routingId,
    purpose: z.enum(["receipt", "billing"]),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const fiscalSchema = z
  .object({
    rfc: z.string().trim().min(12).max(13),
    legal_name: z.string().trim().min(1).max(250),
    postal_code: z.string().regex(/^\d{5}$/),
    tax_regime: z.string().regex(/^\d{3}$/),
    cfdi_use: z.string().trim().min(2).max(4),
    email: z.preprocess(
      (value) =>
        typeof value === "string" && !value.trim() ? undefined : value,
      z.string().trim().email().max(254).optional(),
    ),
    confirmed: z.literal(true),
  })
  .strict();

function customerOrigin(env: RuntimeEnv) {
  try {
    const url = new URL(String(env.CUSTOMER_APP_ORIGIN ?? ""));
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (
      (url.protocol !== "https:" && !(loopback && url.protocol === "http:")) ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      throw new Error();
    return url.origin;
  } catch {
    throw new HttpError(
      503,
      "Configure CUSTOMER_APP_ORIGIN as the customer app's HTTPS origin.",
    );
  }
}

export function revokeCustomerCapabilityLink(
  state: State,
  orderId: string,
  purpose: CustomerCapabilityPurpose,
) {
  for (const grant of state.customer_automation?.grants ?? [])
    if (
      grant.order_id === orderId &&
      grant.purpose === purpose &&
      !grant.revoked_at
    )
      grant.revoked_at = new Date().toISOString();
  return { revoked: true };
}

/** Mutates digest-only private grants. The caller must persist before exposing the URL. */
export async function issueCustomerCapabilityLink(
  state: State,
  input: Order,
  purpose: CustomerCapabilityPurpose,
  env: RuntimeEnv,
) {
  if (purpose !== "receipt" && purpose !== "billing")
    throw new HttpError(422, "Unknown customer capability purpose.");
  const order = state.orders.find(
    (item) => item.id === input.id && item.merchant_id === state.merchant.id,
  );
  if (!order) throw new HttpError(404, "Order not found in your workspace.");
  const origin = customerOrigin(env);
  const grantId = `grant_${crypto.randomUUID()}`;
  const secret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const token = btoa(
    JSON.stringify({
      merchant_id: state.merchant.id,
      order_id: order.id,
      grant_id: grantId,
      purpose,
      secret,
    }),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const expires_at = new Date(Date.now() + 3_600_000).toISOString();
  const automation = (state.customer_automation ??= { jobs: [] });
  const grants = (automation.grants ??= []);
  for (const existing of grants)
    if (
      existing.order_id === order.id &&
      existing.purpose === purpose &&
      !existing.revoked_at
    )
      existing.revoked_at = new Date().toISOString();
  grants.push({
    id: grantId,
    order_id: order.id,
    purpose,
    hash: await sha256Hex(token),
    expires_at,
  });
  return {
    url: `${origin}/customer?purpose=${purpose}#${token}`,
    expires_at,
    grant_id: grantId,
  };
}

async function authenticate(
  request: Request,
  repo: Repository,
  purpose: CustomerCapabilityPurpose,
) {
  const invalid = () =>
    new HttpError(
      401,
      "This customer link is invalid, expired, or has been replaced.",
    );
  const token = request.headers
    .get("Authorization")
    ?.match(/^Bearer ([A-Za-z0-9_-]{80,2000})$/)?.[1];
  if (!token) throw invalid();
  let envelope: z.infer<typeof envelopeSchema>;
  try {
    envelope = envelopeSchema.parse(
      JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/"))),
    );
  } catch {
    throw invalid();
  }
  if (envelope.purpose !== purpose) throw invalid();
  const stored = await repo.loadByMerchant(envelope.merchant_id);
  const state = stored?.state as State | undefined;
  const grant = state?.customer_automation?.grants?.find(
    (item) =>
      item.id === envelope.grant_id &&
      item.order_id === envelope.order_id &&
      item.purpose === purpose,
  );
  const order = state?.orders.find(
    (item) =>
      item.id === envelope.order_id &&
      item.merchant_id === envelope.merchant_id,
  );
  const digest = await sha256Hex(token);
  let different = 0;
  const expected = grant?.hash ?? "0".repeat(64);
  for (let i = 0; i < 64; i++)
    different |= digest.charCodeAt(i) ^ expected.charCodeAt(i);
  if (
    !stored ||
    !state ||
    state.merchant.id !== envelope.merchant_id ||
    !grant ||
    !order ||
    different ||
    grant.revoked_at ||
    !Number.isFinite(Date.parse(grant.expires_at)) ||
    Date.parse(grant.expires_at) <= Date.now()
  )
    throw invalid();
  return { stored, state, grant, order };
}

async function readBody(request: Request) {
  if (
    !request.headers
      .get("Content-Type")
      ?.toLowerCase()
      .startsWith("application/json")
  )
    throw new HttpError(415, "Content-Type must be application/json.");
  if (Number(request.headers.get("Content-Length") ?? 0) > 16_384)
    throw new HttpError(413, "Request is too large.");
  if (!request.body) throw new HttpError(400, "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    size += chunk.value.byteLength;
    if (size > 16_384) {
      await reader.cancel();
      throw new HttpError(413, "Request is too large.");
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new HttpError(400, "A valid JSON body is required.");
  }
}

/** Capability-only public surface. Unknown routes fall through; billing POST persists via CAS. */
export async function handleCustomerCapability(
  request: Request,
  env: RuntimeEnv,
  repo: Repository,
): Promise<Response | undefined> {
  const route = new URL(request.url).pathname;
  const purpose =
    route === "/api/customer/receipt"
      ? "receipt"
      : route === "/api/customer/billing"
        ? "billing"
        : undefined;
  if (!purpose) return undefined;
  // Existing receipt links and billing PUTs keep their original authenticated handler.
  if (
    request.method === "PUT" ||
    request.headers.get("Access-Control-Request-Method") === "PUT"
  ) return undefined;
  const bearer = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9_-]{80,2000})$/)?.[1];
  if (bearer) {
    try {
      const envelope = JSON.parse(atob(bearer.replace(/-/g, "+").replace(/_/g, "/")));
      if (!envelope || typeof envelope !== "object" || !Object.hasOwn(envelope, "grant_id"))
        return undefined;
    } catch {
      // Invalid capabilities are rejected by authenticate below.
    }
  }
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    Vary: "Origin",
  };
  const json = (value: unknown, status = 200) =>
    new Response(status === 204 ? null : JSON.stringify(value), {
      status,
      headers,
    });
  try {
    const origin = customerOrigin(env);
    const caller = request.headers.get("Origin");
    if (caller && caller !== origin)
      throw new HttpError(403, "This customer app origin is not allowed.");
    if (caller) headers["Access-Control-Allow-Origin"] = origin;
    const methods =
      purpose === "billing" ? ["GET", "POST", "OPTIONS"] : ["GET", "OPTIONS"];
    if (!methods.includes(request.method))
      throw new HttpError(405, "Method not allowed.");
    if (request.method === "OPTIONS") {
      const requested = request.headers.get("Access-Control-Request-Method");
      if (requested && !methods.includes(requested))
        throw new HttpError(405, "Method not allowed.");
      headers["Access-Control-Allow-Methods"] = methods.join(", ");
      headers["Access-Control-Allow-Headers"] = "Authorization, Content-Type";
      return json(null, 204);
    }
    const { stored, state, grant, order } = await authenticate(
      request,
      repo,
      purpose,
    );
    if (purpose === "receipt")
      return json({
        purpose,
        merchant: {
          name: state.merchant.name,
          currency: state.merchant.currency,
        },
        order: {
          reference: order.external_reference,
          status: order.status,
          payment_status: order.payment_status,
          currency: order.currency,
          items: order.items.map((line) => ({
            name: line.name,
            quantity: line.quantity,
            unit_price: line.unit_price,
            modifiers: line.modifiers.map((modifier) => ({
              name: modifier.name,
              price_delta: modifier.price_delta,
            })),
          })),
          subtotal: order.subtotal,
          tax: order.tax,
          fees: order.fees,
          total: order.total,
        },
        expires_at: grant.expires_at,
      });
    if (request.method === "GET")
      return json({
        purpose,
        status: grant.used_at ? "ON_FILE" : "PENDING",
        required_fields: [
          "rfc",
          "legal_name",
          "postal_code",
          "tax_regime",
          "cfdi_use",
        ],
        optional_fields: ["email"],
        expires_at: grant.expires_at,
      });
    const { confirmed: _confirmed, ...fiscal } = fiscalSchema.parse(
      await readBody(request),
    );
    const hash = await sha256Hex(JSON.stringify(fiscal));
    if (grant.used_at) {
      if (grant.submission_hash !== hash)
        throw new HttpError(
          409,
          "This billing link has already been submitted. Ask the restaurant for a new link.",
        );
      return json({ status: "ON_FILE", saved: true });
    }
    saveCustomerBillingProfile(
      state,
      customerIdForOrder(state, order.id),
      fiscal,
    );
    grant.used_at = new Date().toISOString();
    grant.submission_hash = hash;
    if (!(await repo.saveTrusted(state.merchant.id, stored.revision, state)))
      throw new HttpError(409, "Your information changed. Please try again.");
    return json({ status: "ON_FILE", saved: true });
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        {
          error:
            "Please check the required billing fields and confirm your submission.",
        },
        422,
      );
    return json(
      { error: "Your customer request could not be completed." },
      400,
    );
  }
}
