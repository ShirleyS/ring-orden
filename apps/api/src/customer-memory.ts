import { z } from "zod";
import {
  createOrder,
  applyOperation,
} from "../../../packages/ring-orden-core/src/index.ts";
import type {
  Order,
  PricingRules,
} from "../../../packages/ring-orden-core/src/index.ts";
import { HttpError, sha256Hex } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";
import type { MerchantRole, Session, TenantState } from "./types.ts";

export interface CustomerRecord {
  id: string;
  merchant_id: string;
  name: string | null;
  phone: string;
  language: "es-MX" | "en-US" | "zh-CN";
  whatsapp_consent: boolean;
  created_at: string;
  updated_at: string;
}
export interface CustomerPreference {
  id: string;
  customer_id: string;
  key: string;
  value: string | number | boolean;
  source: "explicit";
  created_at: string;
  updated_at: string;
  updated_by: string;
}
export interface CustomerBillingProfile {
  id: string;
  customer_id: string;
  rfc: string;
  legal_name: string;
  postal_code: string;
  tax_regime: string;
  cfdi_use: string;
  email?: string;
  alias?: string;
  is_default?: boolean;
  updated_at: string;
}
export interface CustomerMemoryState {
  merchant_id: string;
  customers: CustomerRecord[];
  preferences: CustomerPreference[];
  events: {
    id: string;
    customer_id: string;
    type: string;
    detail: string;
    created_at: string;
  }[];
  billing_profiles: CustomerBillingProfile[];
  data_requests: {
    id: string;
    customer_id: string;
    type: "export" | "deletion";
    status: "PENDING_REVIEW";
    created_at: string;
  }[];
  invoice_requests: {
    id: string;
    customer_id: string;
    order_id: string;
    profile_id: string;
    status: "PENDING_PROVIDER";
    created_at: string;
  }[];
  challenges: {
    id: string;
    customer_id: string;
    session_id: string;
    token_hash: string;
    expires_at: string;
    consumed_at?: string;
  }[];
  verifications: {
    id: string;
    customer_id: string;
    session_id: string;
    expires_at: string;
    revoked_at?: string;
  }[];
}
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const languages = ["es-MX", "en-US", "zh-CN"] as const;
const tools = new Set([
  "get_customer_context",
  "get_customer_preferences",
  "update_customer_preference",
  "get_previous_orders",
  "reorder_previous_order",
  "get_billing_profile_status",
  "request_invoice",
  "verify_customer",
]);

/** Explicit international numbers only; a local number is too ambiguous to join identities. */
export function normalizePhone(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length > 40 ||
    !/^\s*\+[0-9 ()\-.]+\s*$/.test(value)
  )
    return null;
  const normalized = value.trim().replace(/[ ()\-.]/g, "");
  return /^\+[1-9][0-9]{7,14}$/.test(normalized) ? normalized : null;
}
function store(state: TenantState): CustomerMemoryState {
  const target = state as TenantState & {
    customer_memory?: CustomerMemoryState;
  };
  if (
    target.customer_memory &&
    target.customer_memory.merchant_id !== state.merchant.id
  )
    throw new HttpError(403, "Customer memory belongs to another workspace.");
  const data = (target.customer_memory ??= {
    merchant_id: state.merchant.id,
    customers: [],
    preferences: [],
    events: [],
    billing_profiles: [],
    data_requests: [],
    invoice_requests: [],
    challenges: [],
    verifications: [],
  });
  data.data_requests ??= [];
  return data;
}
function event(
  state: TenantState,
  customerId: string,
  type: string,
  detail: string,
) {
  const data = store(state);
  data.events.push({
    id: id("customer_event"),
    customer_id: customerId,
    type,
    detail,
    created_at: now(),
  });
  if (data.events.length > 2000)
    data.events.splice(0, data.events.length - 2000);
}
function customerForPhone(
  state: TenantState,
  phone: string,
  name: string | null,
): CustomerRecord {
  const data = store(state);
  const matches = data.customers.filter(
    (c) => c.merchant_id === state.merchant.id && c.phone === phone,
  );
  if (matches.length > 1)
    throw new HttpError(
      409,
      "Ambiguous customer contact requires staff review.",
    );
  if (matches[0]) return matches[0];
  const customer: CustomerRecord = {
    id: id("customer"),
    merchant_id: state.merchant.id,
    name: name?.slice(0, 160) ?? null,
    phone,
    language: "es-MX",
    whatsapp_consent: false,
    created_at: now(),
    updated_at: now(),
  };
  data.customers.push(customer);
  event(
    state,
    customer.id,
    "customer.recognized",
    "Contact recognized from an order; identity remains unverified.",
  );
  return customer;
}
function canonicalSession(state: TenantState, session: Session): Order {
  if (!state.sessions.includes(session))
    throw new HttpError(403, "A bound session is required.");
  const order = state.orders.find(
    (o) => o.id === session.order_id && o.merchant_id === state.merchant.id,
  );
  if (!order)
    throw new HttpError(404, "Session order not found in this workspace.");
  return order;
}
export function customerIdForOrder(
  state: TenantState,
  orderId: string,
): string {
  const order = state.orders.find(
    (o) => o.id === orderId && o.merchant_id === state.merchant.id,
  );
  if (!order) throw new HttpError(404, "Order not found in this workspace.");
  const phone = normalizePhone(order.customer.phone);
  if (!phone)
    throw new HttpError(409, "An international customer contact is required.");
  return customerForPhone(state, phone, order.customer.name).id;
}
function customerForSession(
  state: TenantState,
  session: Session,
): CustomerRecord | null {
  const order = canonicalSession(state, session);
  const phone = normalizePhone(order.customer.phone);
  return phone ? customerForPhone(state, phone, order.customer.name) : null;
}
function ownCustomer(state: TenantState, customerId: string): CustomerRecord {
  const customer = store(state).customers.find(
    (c) => c.id === customerId && c.merchant_id === state.merchant.id,
  );
  if (!customer)
    throw new HttpError(404, "Customer not found in this workspace.");
  return customer;
}
function verified(
  state: TenantState,
  session: Session,
  customer: CustomerRecord,
): boolean {
  return store(state).verifications.some(
    (v) =>
      v.customer_id === customer.id &&
      v.session_id === session.id &&
      !v.revoked_at &&
      Number.isFinite(Date.parse(v.expires_at)) &&
      Date.parse(v.expires_at) > Date.now(),
  );
}
function requireVerification(
  state: TenantState,
  session: Session,
  customer: CustomerRecord,
) {
  if (!verified(state, session, customer))
    throw new HttpError(
      403,
      "Customer verification is required for this action.",
    );
}
function ordersFor(state: TenantState, customer: CustomerRecord): Order[] {
  return state.orders.filter(
    (o) =>
      o.merchant_id === state.merchant.id &&
      normalizePhone(o.customer.phone) === customer.phone,
  );
}
function orderSummary(order: Order) {
  return {
    id: order.id,
    reference: order.external_reference,
    created_at: order.created_at,
    status: order.status,
    payment_status: order.payment_status,
    total: order.total,
    currency: order.currency,
    items: order.items.map((i) => ({
      catalog_item_id: i.catalog_item_id,
      name: i.name,
      quantity: i.quantity,
      modifiers: i.modifiers.map((m) => ({
        modifier_id: m.modifier_id,
        name: m.name,
      })),
    })),
  };
}
function preferences(state: TenantState, customer: CustomerRecord) {
  const explicit = store(state).preferences.filter(
    (p) => p.customer_id === customer.id,
  );
  const completed = ordersFor(state, customer).filter(
    (o) => o.status === "COMPLETED" && o.payment_status === "PAID",
  );
  const itemCounts = new Map<string, number>();
  const milkCounts = new Map<string, number>();
  const temperatureCounts = new Map<string, number>();
  const add = (counts: Map<string, number>, key: string, quantity: number) =>
    counts.set(key, (counts.get(key) ?? 0) + quantity);
  for (const order of completed)
    for (const line of order.items) {
      add(itemCounts, line.catalog_item_id, line.quantity);
      const catalogItem = state.catalog.find(
        (item) => item.id === line.catalog_item_id,
      );
      for (const modifier of line.modifiers) {
        const catalogModifier = catalogItem?.modifiers.find(
          (m) => m.id === modifier.modifier_id,
        );
        if (
          catalogModifier?.group === "milk" ||
          /^(oat|almond|soy|whole|skim|lactose_free)_milk$/.test(
            modifier.modifier_id,
          )
        )
          add(milkCounts, modifier.modifier_id, line.quantity);
        if (catalogModifier?.group === "temperature")
          add(temperatureCounts, modifier.modifier_id, line.quantity);
      }
      // Only catalog conventions with explicit temperature meaning contribute.
      if (line.catalog_item_id.startsWith("iced_"))
        add(temperatureCounts, "iced", line.quantity);
      else if (
        line.catalog_item_id.startsWith("hot_") ||
        ["latte", "cappuccino", "americano"].includes(line.catalog_item_id)
      )
        add(temperatureCounts, "hot", line.quantity);
    }
  const inferred: {
    key: string;
    value: string;
    source: "inferred";
    completed_order_count: number;
    observations: number;
  }[] = [];
  for (const [key, counts] of [
    ["favorite_item", itemCounts],
    ["milk", milkCounts],
    ["temperature", temperatureCounts],
  ] as const) {
    const favorite = [...counts].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    )[0];
    if (favorite)
      inferred.push({
        key,
        value: favorite[0],
        source: "inferred",
        completed_order_count: completed.length,
        observations: favorite[1],
      });
  }
  return { explicit: structuredClone(explicit), inferred };
}
const preferenceSchema = z
  .object({
    key: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[a-z][a-z0-9_]*$/),
    value: z.union([
      z.string().trim().min(1).max(240),
      z.number().finite(),
      z.boolean(),
    ]),
    confirmed: z.literal(true),
    scope: z.literal("permanent"),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success)
    throw new HttpError(
      422,
      result.error.issues.map((i) => i.message).join("; "),
    );
  return result.data;
}
function preferenceInput(body: Record<string, unknown>) {
  return {
    key: body.key ?? body.preference_key,
    value: body.value ?? body.preference_value,
    confirmed: body.confirmed,
    scope: body.scope,
  };
}
function savePreference(
  state: TenantState,
  customer: CustomerRecord,
  body: Record<string, unknown>,
  actor: string,
) {
  const input = parse(preferenceSchema, preferenceInput(body));
  const data = store(state);
  let preference = data.preferences.find(
    (p) => p.customer_id === customer.id && p.key === input.key,
  );
  if (preference) {
    preference.value = input.value;
    preference.updated_at = now();
    preference.updated_by = actor;
  } else {
    preference = {
      id: id("preference"),
      customer_id: customer.id,
      key: input.key,
      value: input.value,
      source: "explicit",
      created_at: now(),
      updated_at: now(),
      updated_by: actor,
    };
    data.preferences.push(preference);
  }
  customer.updated_at = now();
  event(
    state,
    customer.id,
    "preference.updated",
    `Explicit preference ${input.key} confirmed.`,
  );
  return {
    saved: true,
    customer_id: customer.id,
    preference: structuredClone(preference),
  };
}
function billingStatus(state: TenantState, customerId: string) {
  return store(state).billing_profiles.some((p) => p.customer_id === customerId)
    ? "ON_FILE"
    : "MISSING";
}
function customerView(state: TenantState, customer: CustomerRecord) {
  return {
    ...customer,
    display_name: customer.name,
    preferred_language: customer.language,
    billing_status: billingStatus(state, customer.id),
    billing_profile_count: store(state).billing_profiles.filter(
      (p) => p.customer_id === customer.id,
    ).length,
    order_count: ordersFor(state, customer).length,
  };
}
const billingSchema = z
  .object({
    rfc: z
      .string()
      .trim()
      .transform((v) => v.toUpperCase())
      .pipe(z.string().regex(/^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/)),
    legal_name: z.string().trim().min(1).max(200),
    postal_code: z.string().regex(/^[0-9]{5}$/),
    tax_regime: z.string().regex(/^[0-9]{3}$/),
    cfdi_use: z.string().regex(/^[A-Z][0-9]{2}$/),
    email: z.string().email().max(254).optional(),
    alias: z.string().trim().min(1).max(80).optional(),
    profile_id: z.string().min(1).max(160).optional(),
    id: z.string().min(1).max(160).optional(),
    is_default: z.boolean().optional(),
  })
  .strict();
/** Trusted merchant/capability ingress only. This stores fiscal details, never issues CFDI. */
export function saveCustomerBillingProfile(
  state: TenantState,
  customerId: string,
  body: Record<string, unknown>,
) {
  ownCustomer(state, customerId);
  const input = parse(billingSchema, body);
  const data = store(state);
  if (input.id && input.profile_id && input.id !== input.profile_id)
    throw new HttpError(422, "Conflicting billing profile IDs.");
  const profileId = input.profile_id ?? input.id;
  let profile = profileId
    ? data.billing_profiles.find(
        (p) => p.id === profileId && p.customer_id === customerId,
      )
    : undefined;
  if (profileId && !profile)
    throw new HttpError(404, "Billing profile not found for this customer.");
  const { profile_id: ignoredProfileId, id: ignoredId, ...values } = input;
  if (profile) Object.assign(profile, values, { updated_at: now() });
  else {
    profile = {
      id: id("billing"),
      customer_id: customerId,
      ...values,
      alias: input.alias ?? "Billing profile",
      is_default:
        input.is_default ??
        !data.billing_profiles.some((p) => p.customer_id === customerId),
      updated_at: now(),
    };
    data.billing_profiles.push(profile);
  }
  if (profile.is_default)
    for (const other of data.billing_profiles)
      if (other.customer_id === customerId && other.id !== profile.id)
        other.is_default = false;
  event(
    state,
    customerId,
    "billing.updated",
    "Billing profile submitted; provider issuance is not configured.",
  );
  return { status: "ON_FILE", customer_id: customerId, profile_id: profile.id };
}
function customerOrigin(env: RuntimeEnv): string {
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
      "Configure a secure customer app origin before sending verification links.",
    );
  }
}
const envelopeSchema = z
  .object({
    merchant_id: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_-]+$/),
    challenge_id: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_-]+$/),
    secret: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
function verificationEnvelope(token: string) {
  try {
    if (!/^[A-Za-z0-9_-]{80,1600}$/.test(token)) throw new Error();
    return envelopeSchema.parse(
      JSON.parse(atob(token.replace(/-/g, "+").replace(/_/g, "/"))),
    );
  } catch {
    throw new HttpError(401, "This verification link is invalid or expired.");
  }
}
/** Routing hint only. Completion must still check the stored capability digest. */
export function readCustomerVerificationTenant(token: string): string {
  return verificationEnvelope(token).merchant_id;
}
/** Never return this result to a voice/model tool: send only through a trusted contact channel. */
export async function issueCustomerVerificationChallenge(
  state: TenantState,
  session: Session,
  env: RuntimeEnv,
) {
  const origin = customerOrigin(env);
  const customer = customerForSession(state, session);
  if (!customer)
    throw new HttpError(409, "An international customer contact is required.");
  const secret = [...crypto.getRandomValues(new Uint8Array(32))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  const challenge_id = id("verification");
  const token = btoa(
    JSON.stringify({ merchant_id: state.merchant.id, challenge_id, secret }),
  )
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
  const data = store(state);
  // Reissuance invalidates earlier pending links for the same session/customer.
  for (const challenge of data.challenges)
    if (
      challenge.customer_id === customer.id &&
      challenge.session_id === session.id &&
      !challenge.consumed_at
    )
      challenge.consumed_at = now();
  data.challenges.push({
    id: challenge_id,
    customer_id: customer.id,
    session_id: session.id,
    token_hash: await sha256Hex(token),
    expires_at,
  });
  if (data.challenges.length > 1000)
    data.challenges = data.challenges
      .filter((c) => Date.parse(c.expires_at) > Date.now())
      .slice(-1000);
  return {
    url: `${origin}/customer?purpose=verify#${token}`,
    token,
    challenge_id,
    expires_at,
    customer_id: customer.id,
    session_id: session.id,
  };
}
export async function completeCustomerVerification(
  state: TenantState,
  token: string,
) {
  const invalid = () =>
    new HttpError(401, "This verification link is invalid or expired.");
  const envelope = verificationEnvelope(token);
  if (envelope.merchant_id !== state.merchant.id) throw invalid();
  const data = store(state);
  const challenge = data.challenges.find((c) => c.id === envelope.challenge_id);
  const digest = await sha256Hex(token);
  let difference = 0;
  const expected = challenge?.token_hash ?? "0".repeat(64);
  for (let n = 0; n < 64; n++)
    difference |= digest.charCodeAt(n) ^ expected.charCodeAt(n);
  if (
    !challenge ||
    difference ||
    challenge.consumed_at ||
    !Number.isFinite(Date.parse(challenge.expires_at)) ||
    Date.parse(challenge.expires_at) <= Date.now()
  )
    throw invalid();
  const session = state.sessions.find((s) => s.id === challenge.session_id);
  if (!session) throw invalid();
  const customer = customerForSession(state, session);
  if (!customer || customer.id !== challenge.customer_id) throw invalid();
  challenge.consumed_at = now();
  const expires_at = new Date(Date.now() + 10 * 60_000).toISOString();
  data.verifications.push({
    id: id("verified"),
    customer_id: customer.id,
    session_id: session.id,
    expires_at,
  });
  data.verifications = data.verifications
    .filter((v) => !v.revoked_at && Date.parse(v.expires_at) > Date.now())
    .slice(-1000);
  event(
    state,
    customer.id,
    "customer.verified",
    "One-time contact capability completed for a bound session.",
  );
  return {
    verified: true,
    customer_id: customer.id,
    session_id: session.id,
    expires_at,
  };
}
function pricingRules(state: TenantState): PricingRules {
  const settings = state.settings.business ?? {};
  const rules: PricingRules = {};
  for (const key of [
    "tax_rate",
    "fee_amount",
    "minimum_order",
    "maximum_order",
    "maximum_quantity",
  ] as const)
    if (typeof settings[key] === "number") rules[key] = settings[key] as number;
  return rules;
}

export async function handleCustomerTool(
  state: TenantState,
  tool: string,
  body: Record<string, unknown>,
  session: Session,
  env: RuntimeEnv,
): Promise<unknown> {
  if (!tools.has(tool)) return undefined;
  const customer = customerForSession(state, session);
  if (tool === "get_customer_context")
    return customer
      ? {
          recognized: true,
          customer_id: customer.id,
          verified: verified(state, session, customer),
          preferred_language: customer.language,
          verification_required: !verified(state, session, customer),
        }
      : {
          recognized: false,
          verified: false,
          preferred_language: "es-MX",
          verification_required: true,
        };
  if (!customer)
    throw new HttpError(409, "An international customer contact is required.");
  if (tool === "verify_customer") {
    let verification_url: string | undefined;
    try {
      verification_url = `${customerOrigin(env)}/customer?purpose=verify`;
    } catch {
      /* Normal ordering remains available when delivery is not configured. */
    }
    return {
      status: verified(state, session, customer)
        ? "VERIFIED"
        : "VERIFICATION_REQUIRED",
      verified: verified(state, session, customer),
      delivery_status: "NOT_CONFIGURED",
      ...(verification_url ? { verification_url } : {}),
      message:
        "The restaurant must send a secure verification link to your contact. No OTP delivery is configured.",
    };
  }
  if (
    tool === "update_customer_preference" &&
    ["order", "one_time"].includes(String(body.scope))
  )
    return {
      saved: false,
      scope: "order",
      requires_order_update: true,
      message:
        "Apply this instruction to the current order only; permanent memory was not changed.",
    };
  if (tool === "get_customer_preferences") {
    const result = preferences(state, customer);
    const isVerified = verified(state, session, customer);
    if (isVerified)
      return {
        customer_id: customer.id,
        verified: true,
        verification_required: false,
        redacted: false,
        ...result,
      };
    const safeKeys = new Set([
      "milk",
      "temperature",
      "sweetness",
      "pickup_location",
    ]);
    const safeValue = (value: unknown) =>
      typeof value === "string" && value.length <= 80 && !/[@+\d]/.test(value);
    return {
      customer_id: customer.id,
      verified: false,
      verification_required: true,
      redacted: true,
      explicit: result.explicit
        .filter((p) => safeKeys.has(p.key) && safeValue(p.value))
        .map((p) => ({ key: p.key, value: p.value, source: p.source })),
      inferred: result.inferred.filter(
        (p) => safeKeys.has(p.key) && safeValue(p.value),
      ),
    };
  }
  requireVerification(state, session, customer);
  if (tool === "update_customer_preference")
    return savePreference(state, customer, body, "customer");
  if (tool === "get_billing_profile_status")
    return {
      status: billingStatus(state, customer.id),
      can_request_invoice: true,
      provider_status: "NOT_CONFIGURED",
    };
  const previous = ordersFor(state, customer)
    .filter(
      (o) =>
        o.id !== session.order_id &&
        o.status === "COMPLETED" &&
        o.payment_status === "PAID",
    )
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (tool === "get_previous_orders") {
    if (
      ["location", "location_id", "branch_id"].some(
        (key) => body[key] !== undefined,
      )
    )
      throw new HttpError(
        422,
        "Location filtering is not available for canonical orders yet.",
      );
    const query = parse(
      z.object({
        mode: z.enum(["recent", "most_recent", "frequent"]).default("recent"),
        limit: z.number().int().min(1).max(20).default(20),
      }),
      { mode: body.mode, limit: body.limit },
    );
    if (query.mode === "most_recent")
      return {
        mode: query.mode,
        orders: previous.slice(0, 1).map(orderSummary),
      };
    if (query.mode === "frequent") {
      const groups = new Map<string, { order: Order; frequency: number }>();
      for (const order of previous) {
        const lines = new Map<string, number>();
        for (const line of order.items) {
          const key = JSON.stringify([
            line.catalog_item_id,
            line.modifiers.map((m) => m.modifier_id).sort(),
          ]);
          lines.set(key, (lines.get(key) ?? 0) + line.quantity);
        }
        const signature = JSON.stringify(
          [...lines].sort((a, b) => a[0].localeCompare(b[0])),
        );
        const existing = groups.get(signature);
        if (existing) existing.frequency++;
        else groups.set(signature, { order, frequency: 1 });
      }
      return {
        mode: query.mode,
        orders: [...groups.values()]
          .sort(
            (a, b) =>
              b.frequency - a.frequency ||
              b.order.created_at.localeCompare(a.order.created_at),
          )
          .slice(0, query.limit)
          .map((g) => ({ ...orderSummary(g.order), frequency: g.frequency })),
      };
    }
    return {
      mode: query.mode,
      orders: previous.slice(0, query.limit).map(orderSummary),
    };
  }
  if (tool === "reorder_previous_order") {
    const source = previous.find((o) => o.id === body.order_id);
    if (!source)
      throw new HttpError(404, "Previous order not found for this customer.");
    let draft = createOrder(state.merchant.id);
    draft.customer = { name: customer.name, phone: customer.phone };
    draft.currency = state.merchant.currency;
    try {
      for (const line of source.items)
        draft = applyOperation(
          draft,
          {
            action: "add_item",
            catalog_item_id: line.catalog_item_id,
            quantity: line.quantity,
            modifier_ids: line.modifiers.map((m) => m.modifier_id),
          },
          state.catalog,
          pricingRules(state),
        );
    } catch (error) {
      return {
        status: "UNAVAILABLE",
        session_id: session.id,
        requires_confirmation: true,
        message:
          error instanceof Error
            ? error.message
            : "Review current menu availability with the restaurant.",
      };
    }
    if (!draft.items.length)
      return {
        status: "UNAVAILABLE",
        session_id: session.id,
        requires_confirmation: true,
        message: "The previous order has no reorderable items.",
      };
    const newSession: Session = {
      id: id("session"),
      order_id: draft.id,
      turns: [],
      created_at: now(),
      status: "ACTIVE",
      pending_corrections: [],
    };
    state.orders.push(draft);
    state.sessions.push(newSession);
    state.order_metadata[draft.id] = {
      pos_status: "DASHBOARD_ONLY",
      notification_status: "PENDING",
      demo: env.DEMO_MODE !== "false",
    };
    event(
      state,
      customer.id,
      "order.reorder_draft",
      "Previous items repriced into a new draft; confirmation remains required.",
    );
    return {
      status: "DRAFT",
      order_id: draft.id,
      session_id: newSession.id,
      total: draft.total,
      currency: draft.currency,
      requires_confirmation: true,
      items: orderSummary(draft).items,
    };
  }
  if (tool === "request_invoice") {
    if (body.confirmed !== true)
      throw new HttpError(
        422,
        "Explicit invoice request confirmation is required.",
      );
    const order = ordersFor(state, customer).find(
      (o) => o.id === body.order_id && o.payment_status === "PAID",
    );
    if (!order)
      throw new HttpError(404, "Paid order not found for this customer.");
    const data = store(state);
    const profiles = data.billing_profiles.filter(
      (p) => p.customer_id === customer.id,
    );
    const profile =
      body.profile_id !== undefined
        ? profiles.find((p) => p.id === body.profile_id)
        : (profiles.find((p) => p.is_default) ?? profiles[0]);
    if (body.profile_id !== undefined && !profile)
      throw new HttpError(404, "Billing profile not found for this customer.");
    if (!profile)
      throw new HttpError(
        409,
        "Submit a billing profile through the secure customer form first.",
      );
    let invoice = data.invoice_requests.find(
      (r) => r.customer_id === customer.id && r.order_id === order.id,
    );
    if (!invoice) {
      invoice = {
        id: id("invoice_request"),
        customer_id: customer.id,
        order_id: order.id,
        profile_id: profile.id,
        status: "PENDING_PROVIDER",
        created_at: now(),
      };
      data.invoice_requests.push(invoice);
      event(
        state,
        customer.id,
        "invoice.requested",
        "Invoice request queued; CFDI provider issuance is not configured.",
      );
    }
    return {
      request_id: invoice.id,
      order_id: invoice.order_id,
      status: invoice.status,
      issued: false,
      provider_status: "NOT_CONFIGURED",
    };
  }
  return undefined;
}

/** Parent authenticates merchant membership and persists every mutation with its existing CAS. */
export function handleCustomerMerchant(
  state: TenantState,
  path: string[],
  method: string,
  body: Record<string, unknown>,
  role: MerchantRole,
): unknown {
  if (path[0] !== "customers") return undefined;
  if (!["OWNER", "MANAGER"].includes(role))
    throw new HttpError(
      403,
      "Customer management requires an owner or manager.",
    );
  const data = store(state);
  // Contacts derive solely from this tenant's canonical orders.
  for (const order of state.orders)
    if (order.merchant_id === state.merchant.id) {
      const phone = normalizePhone(order.customer.phone);
      if (phone) customerForPhone(state, phone, order.customer.name);
    }
  if (path.length === 1 && method === "GET")
    return {
      customers: data.customers
        .filter((c) => c.merchant_id === state.merchant.id)
        .slice(0, 500)
        .map((c) => customerView(state, c)),
    };
  const customer = ownCustomer(state, path[1] ?? "");
  if (path.length === 2 && method === "GET")
    return {
      customer: customerView(state, customer),
      preferences: preferences(state, customer),
      events: data.events
        .filter((e) => e.customer_id === customer.id)
        .slice(-100)
        .reverse(),
      orders: ordersFor(state, customer)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 50)
        .map(orderSummary),
      billing_status: billingStatus(state, customer.id),
    };
  if (path.length === 2 && method === "PATCH") {
    const input = parse(
      z
        .object({
          name: z.string().trim().min(1).max(160).optional(),
          display_name: z.string().trim().min(1).max(160).optional(),
          language: z.enum(languages).optional(),
          preferred_language: z.enum(languages).optional(),
          whatsapp_consent: z.boolean().optional(),
        })
        .strict(),
      body,
    );
    if (input.name !== undefined || input.display_name !== undefined)
      customer.name = input.name ?? input.display_name ?? null;
    if (input.language || input.preferred_language)
      customer.language = input.language ?? input.preferred_language!;
    if (input.whatsapp_consent !== undefined)
      customer.whatsapp_consent = input.whatsapp_consent;
    customer.updated_at = now();
    event(
      state,
      customer.id,
      "customer.updated",
      `Customer profile updated by ${role.toLowerCase()}.`,
    );
    return { customer: customerView(state, customer) };
  }
  if (path.length === 3 && path[2] === "preferences" && method === "POST")
    return savePreference(state, customer, body, role.toLowerCase());
  if (path.length === 4 && path[2] === "preferences" && method === "DELETE") {
    const index = data.preferences.findIndex(
      (p) => p.id === path[3] && p.customer_id === customer.id,
    );
    if (index < 0)
      throw new HttpError(404, "Preference not found for this customer.");
    const [preference] = data.preferences.splice(index, 1);
    event(
      state,
      customer.id,
      "preference.deleted",
      `Explicit preference ${preference.key} deleted by ${role.toLowerCase()}.`,
    );
    return { deleted: true };
  }
  if (path.length === 3 && path[2] === "data-requests") {
    if (role !== "OWNER")
      throw new HttpError(403, "Customer data requests require the owner.");
    if (method === "GET")
      return {
        requests: data.data_requests.filter(
          (r) => r.customer_id === customer.id,
        ),
        completed: false,
      };
    if (method === "POST") {
      const input = parse(
        z
          .object({
            type: z.enum(["export", "deletion"]),
            confirmed: z.literal(true),
          })
          .strict(),
        body,
      );
      let request = data.data_requests.find(
        (r) =>
          r.customer_id === customer.id &&
          r.type === input.type &&
          r.status === "PENDING_REVIEW",
      );
      if (!request) {
        request = {
          id: id("data_request"),
          customer_id: customer.id,
          type: input.type,
          status: "PENDING_REVIEW",
          created_at: now(),
        };
        data.data_requests.push(request);
        event(
          state,
          customer.id,
          "data.requested",
          `${input.type} request recorded for owner retention review.`,
        );
      }
      return { request: structuredClone(request), completed: false };
    }
  }
  if (path.length === 3 && path[2] === "billing") {
    if (role !== "OWNER")
      throw new HttpError(
        403,
        "Billing profile management requires the owner.",
      );
    if (method === "PATCH" || method === "POST")
      return saveCustomerBillingProfile(state, customer.id, body);
    if (method === "GET")
      return {
        status: billingStatus(state, customer.id),
        profiles: data.billing_profiles
          .filter((p) => p.customer_id === customer.id)
          .map((p) => ({
            id: p.id,
            alias: p.alias ?? "Billing profile",
            is_default: p.is_default === true,
            rfc_masked: `••••${p.rfc.slice(-4)}`,
            has_email: !!p.email,
            updated_at: p.updated_at,
          })),
      };
  }
  throw new HttpError(404, "Customer endpoint not found.");
}
