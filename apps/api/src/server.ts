import { z } from "zod";
import {
  listMenuImports,
  addMenuImport,
  unloadMenuImport,
  restoreMenuImport,
} from "./menu-imports.ts";
import { extractMenuPhoto, ReviewedMenuItemSchema } from "./menu-image.ts";
import {
  createOrder,
  applyOperation,
  applyOperations,
  transitionOrder,
  priceOrder,
  CatalogItemSchema,
  OperationSchema,
} from "../../../packages/ring-orden-core/src/index.ts";
import type {
  Order,
  Operation,
  CatalogItem,
} from "../../../packages/ring-orden-core/src/index.ts";
import {
  interpretDemo,
  isExplicitConfirmation,
  OpenAICompatibleAdapter,
  Gateway,
  runCompatibilityTest,
} from "../../../packages/openmodel-gateway/src/index.ts";
import {
  retrieveMemories,
  detectCorrection,
  extractCorrection,
  approveMemory,
  disableMemory,
  editMemory,
  mergeObservation,
  recordMemoryUse,
} from "../../../packages/ring-orden-memory/src/index.ts";
import {
  identityFromRequest,
  tenantIdFor,
  validateMutationOrigin,
  verifyMojoToken,
  makeSessionCookie,
  linkMojoIdentity,
  sha256Hex,
  newInvitationToken,
  configuredAgentSecret,
  HttpError,
} from "./auth.ts";
import type { RuntimeEnv, Identity } from "./auth.ts";
import { handleMojoAuthRequest } from "./mojoauth-login.ts";
import { repositoryFor, storageStatus } from "./storage.ts";
import { prepareSupabaseMigration } from "./supabase-migration.ts";
import {
  guardMerchantRoute,
  redactWorkspace,
  redactOrderForRole,
} from "./rbac.ts";
import { seedTenant } from "./seed.ts";
import { SettingsSchemas, orderingIsOpen } from "./settings.ts";
import { retryDuePOS } from "./pos-retry.ts";
import { twilioAuthorization } from "./twilio-auth.ts";
import {
  recordReceiptConsent,
  sendPendingCustomerReceipt,
  receiptRetryAllowed,
} from "./customer-receipt-delivery.ts";
import { configureElevenLabsTools } from "./elevenlabs-setup.ts";
import {
  handleCustomerTool,
  handleCustomerMerchant,
  normalizePhone,
  issueCustomerVerificationChallenge,
  readCustomerVerificationTenant,
  completeCustomerVerification,
} from "./customer-memory.ts";
import {
  handleAutomationTool,
  queueCustomerVerification,
  issueRecoveryLink,
} from "./customer-automation.ts";
import {
  handleCustomerCapability,
  issueCustomerCapabilityLink,
  revokeCustomerCapabilityLink,
} from "./customer-capabilities.ts";
import {
  handleElevenLabsEvent,
  queueCompletedReceipts,
  saveFollowupConsent,
} from "./followup-events.ts";
import {
  handleCustomerOrderRequest,
  issueCustomerOrderLink,
  revokeCustomerOrderLink,
  issueCustomerReceiptLink,
  revokeCustomerReceiptLink,
} from "./customer-orders.ts";
import {
  createCheckout,
  expireCheckout,
  sendWhatsApp,
  verifyStripeSignature,
  validatePaidSession,
} from "./payments.ts";
import type {
  Repository,
  TenantState,
  Session,
  JsonObject,
  AuditEvent,
  MerchantRole,
} from "./types.ts";
const json = (value: unknown, status = 200, headers?: HeadersInit) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const uid = (prefix: string) => prefix + "_" + crypto.randomUUID();
function audit(
  state: TenantState,
  type: string,
  title: string,
  detail: string,
  orderId?: string,
  level: AuditEvent["level"] = "info",
  data?: unknown,
) {
  state.events.unshift({
    id: uid("evt"),
    type,
    title,
    detail,
    created_at: new Date().toISOString(),
    order_id: orderId,
    level,
    data,
  });
  state.events = state.events.slice(0, 500);
}
const isDemo = (env: RuntimeEnv) => env.DEMO_MODE !== "false";
function summary(order: Order) {
  const items = order.items
    .map(
      (i) =>
        `${i.quantity} ${i.name}${i.modifiers.length ? " with " + i.modifiers.map((m) => m.name).join(" and ") : ""}`,
    )
    .join(", ");
  return `${items}. Total $${order.total.toFixed(2)} ${order.currency}.`;
}

function metadata(state: TenantState, order: Order) {
  const { billing: _billing, ...safeMetadata } =
    state.order_metadata[order.id] ?? {};
  return {
    ...order,
    ...safeMetadata,
    receipt_retry_allowed: receiptRetryAllowed(
      safeMetadata.receipt_notification,
    ),
    customer_name: order.customer.name,
  };
}
function publicSettings(
  settings: TenantState["settings"],
): TenantState["settings"] {
  const clean = structuredClone(settings);
  for (const section of Object.values(clean))
    for (const key of Object.keys(section))
      if (/api.?key|secret|token|password|authorization|headers/i.test(key)) {
        section["has_" + key] = Boolean(section[key]);
        delete section[key];
      }
  return clean;
}
function integrations(env: RuntimeEnv, state: TenantState) {
  return [
    {
      id: "elevenlabs",
      name: "ElevenLabs",
      category: "Voice agent",
      description: "Speech, voice and turn taking",
      configured: !!(env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID),
      status:
        env.ELEVENLABS_API_KEY && env.ELEVENLABS_AGENT_ID
          ? "configured"
          : "setup_required",
    },
    {
      id: "deepseek",
      name: "DeepSeek",
      category: "AI model",
      description: "Open-weight interpretation",
      configured: !!(env.DEEPSEEK_API_KEY || state.settings.model?.api_key),
      status:
        env.DEEPSEEK_API_KEY || state.settings.model?.api_key
          ? "configured"
          : "setup_required",
    },
    {
      id: "square",
      name: "Square",
      category: "Point of sale",
      description: "Canonical order delivery",
      configured: !!(
        env.SQUARE_ACCESS_TOKEN &&
        (state.settings.pos.location_id || env.SQUARE_LOCATION_ID)
      ),
      status:
        env.SQUARE_ACCESS_TOKEN &&
        (state.settings.pos.location_id || env.SQUARE_LOCATION_ID)
          ? "configured"
          : "setup_required",
    },
    {
      id: "webhook",
      name: "Custom webhook",
      category: "Point of sale",
      description: "Send orders to your own system",
      configured: !!state.settings.pos?.endpoint,
      status: state.settings.pos?.endpoint ? "configured" : "setup_required",
    },
    {
      id: "stripe",
      name: "Stripe",
      category: "Payments",
      description: "Hosted test checkout and verified webhooks",
      configured: !!(env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET),
      status:
        env.STRIPE_SECRET_KEY && env.STRIPE_WEBHOOK_SECRET
          ? "configured"
          : "setup_required",
    },
    {
      id: "twilio",
      name: "Twilio",
      category: "Phone & WhatsApp",
      description: "Phone routing and order notifications",
      configured: !!(env.TWILIO_ACCOUNT_SID && twilioAuthorization(env)),
      status:
        env.TWILIO_ACCOUNT_SID && twilioAuthorization(env)
          ? "configured"
          : "setup_required",
    },
    {
      id: "firecrawl",
      name: "Firecrawl",
      category: "Menu import",
      description: "Read menu photos into reviewed products",
      configured: Boolean(env.FIRECRAWL_API_KEY),
      status: env.FIRECRAWL_API_KEY ? "configured" : "setup_required",
    },
    {
      id: "mojoauth",
      name: "MojoAuth",
      category: "Authentication",
      description: "Passwordless merchant identity",
      configured: !!(
        env.MOJOAUTH_JWKS_URL &&
        env.MOJOAUTH_ISSUER &&
        env.MOJOAUTH_AUDIENCE
      ),
      status: env.MOJOAUTH_JWKS_URL ? "configured" : "setup_required",
    },
    {
      id: "supabase",
      name: "Supabase",
      category: "Database",
      description: env.SUPABASE_URL
        ? "Active scoped Postgres repository"
        : "Optional Postgres repository and RLS migrations included",
      configured: !!(env.SUPABASE_URL && env.SUPABASE_SERVER_SECRET),
      status:
        env.SUPABASE_URL && env.SUPABASE_SERVER_SECRET
          ? "connected"
          : "migration_ready",
    },
    {
      id: "n8n",
      name: "n8n",
      category: "Automation",
      description: "Eight importable orchestration workflows",
      configured: !!env.N8N_WEBHOOK_URL,
      status: env.N8N_WEBHOOK_URL ? "configured" : "setup_required",
    },
  ];
}
function bootstrap(
  state: TenantState,
  identity: Identity,
  env: RuntimeEnv,
  role: MerchantRole = "OWNER",
) {
  const paid = state.orders.filter((o) => o.payment_status === "PAID");
  const confirmed = state.orders.filter(
    (o) =>
      ![
        "DRAFT",
        "AWAITING_CLARIFICATION",
        "AWAITING_CONFIRMATION",
        "CANCELLED",
      ].includes(o.status),
  );
  return {
    storage: storageStatus(env),
    merchant: state.merchant,
    catalog: state.catalog,
    menu_imports: role === "OWNER" ? listMenuImports(state) : [],
    orders: state.orders.map((o) => metadata(state, o)),
    memories: state.memories,
    calls: state.sessions.map((s) => ({
      ...s,
      customer:
        state.orders.find((o) => o.id === s.order_id)?.customer.name ??
        "Guest caller",
      phone: state.orders.find((o) => o.id === s.order_id)?.customer.phone,
      duration: Math.max(32, s.turns.length * 19),
      duration_seconds: Math.max(32, s.turns.length * 19),
      customer_name:
        state.orders.find((o) => o.id === s.order_id)?.customer.name ??
        "Guest caller",
      started_at: s.created_at,
      language: "es-MX / en-US",
      outcome: s.status === "ACTIVE" ? "In progress" : "Order placed",
      demo: isDemo(env),
    })),
    escalations: state.escalations,
    events: state.events.map(({ data, ...event }) => event),
    settings: publicSettings(state.settings),
    integrations: integrations(env, state),
    team: state.team,
    mode: isDemo(env) ? "demo" : "live",
    user: {
      name: identity.name,
      email: identity.email,
      role,
      provider: identity.provider,
    },
    stats: {
      orders: confirmed.length,
      revenue: paid.reduce((s, o) => s + o.total, 0),
      calls: state.sessions.length,
      completed: state.orders.filter((o) => o.status === "COMPLETED").length,
      payment_conversion: confirmed.length
        ? Math.round((paid.length / confirmed.length) * 100)
        : 0,
      pending_payments: state.orders.filter(
        (o) =>
          o.payment_status === "PENDING" &&
          ["CONFIRMED", "PAYMENT_PENDING", "POS_SYNC_FAILED"].includes(
            o.status,
          ),
      ).length,
      escalations: state.escalations.filter((e) => e.status === "OPEN").length,
      average_order_value: paid.length
        ? paid.reduce((s, o) => s + o.total, 0) / paid.length
        : 0,
      memory_uses: state.memories.reduce(
        (s, m) => s + m.successful_retrieval_count,
        0,
      ),
      clarifications: state.events.filter(
        (e) => e.type === "order.clarification",
      ).length,
      corrections: state.events.filter((e) => e.type === "memory.created")
        .length,
    },
  };
}
function rules(state: TenantState) {
  const business = state.settings.business;
  return {
    tax_rate: Number(business.tax_rate ?? 0),
    maximum_order: Number(business.maximum_order ?? 5000),
    maximum_quantity: Number(business.maximum_quantity ?? 50),
    minimum_order: Number(business.minimum_order ?? 0),
  };
}
function orderingAllowed(state: TenantState, env: RuntimeEnv, order: Order) {
  if (
    isDemo(env) ||
    state.settings.agent.after_hours === "accept_orders" ||
    orderingIsOpen(state.settings.business)
  )
    return true;
  const pickup = order.fulfillment.scheduled_for;
  return (
    state.settings.agent.after_hours === "scheduled_orders" &&
    !!pickup &&
    Date.parse(pickup) > Date.now() &&
    orderingIsOpen(state.settings.business, new Date(pickup))
  );
}
function findOrder(state: TenantState, id: string) {
  const order = state.orders.find((o) => o.id === id);
  if (!order) throw new HttpError(404, "Order not found in your workspace.");
  return order;
}
function replaceOrder(state: TenantState, order: Order) {
  const index = state.orders.findIndex((o) => o.id === order.id);
  if (index < 0) state.orders.unshift(order);
  else state.orders[index] = order;
}
async function bodyOf(request: Request) {
  if (Number(request.headers.get("Content-Length") ?? 0) > 100000)
    throw new HttpError(413, "Request is too large.");
  try {
    const text = await request.text();
    if (text.length > 100000) throw new HttpError(413, "Request is too large.");
    return text ? JSON.parse(text) : {};
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(400, "A valid JSON request is required.");
  }
}
const valuesSchema = z.record(z.unknown());
async function syncOrder(state: TenantState, order: Order, env: RuntimeEnv) {
  const config = state.settings.pos;
  const provider = String(config.provider ?? "dashboard");
  const meta = state.order_metadata[order.id] ?? {
    pos_status: "DASHBOARD_ONLY",
    notification_status: "PENDING",
    demo: isDemo(env),
  };
  if (provider === "dashboard" || provider === "none") {
    meta.pos_status = "DASHBOARD_ONLY";
    state.order_metadata[order.id] = meta;
    return order;
  }
  meta.pos_attempts = (meta.pos_attempts ?? 0) + 1;
  try {
    const { SquareAdapter, CustomWebhookAdapter } = await import(
      "../../../packages/ring-orden-connect/src/index.ts"
    );
    let result: unknown;
    if (provider === "square") {
      if (!env.SQUARE_ACCESS_TOKEN || !env.SQUARE_LOCATION_ID)
        throw new Error("Square credentials are not configured.");
      const adapter = new SquareAdapter({
        accessToken: env.SQUARE_ACCESS_TOKEN,
        locationId: String(config.location_id ?? env.SQUARE_LOCATION_ID),
        sandbox: env.SQUARE_ENVIRONMENT !== "production",
        mappings: (config.catalog_mappings ?? {}) as Record<string, string>,
      });
      result = await adapter.createOrder(order);
    } else if (provider === "webhook") {
      const adapter = new CustomWebhookAdapter({
        url: String(config.endpoint ?? ""),
        secret: String(config.secret ?? ""),
        headers: config.token
          ? { Authorization: `Bearer ${String(config.token)}` }
          : {},
      });
      result = await adapter.createOrder(order);
    } else
      throw new Error(
        "This POS provider does not yet have a verified order-write adapter.",
      );
    meta.pos_status = "SYNCED";
    meta.pos_next_retry_at = null;
    audit(
      state,
      "pos.synced",
      "Order sent to POS",
      provider,
      order.id,
      "success",
      result,
    );
    if (
      [
        "CONFIRMED",
        "PAYMENT_PENDING",
        "POS_SYNC_FAILED",
        "POS_SYNC_PENDING",
      ].includes(order.status)
    )
      order = transitionOrder(order, "POS_SYNCED");
  } catch (error) {
    meta.pos_status = "FAILED";
    meta.pos_next_retry_at = new Date(
      Date.now() +
        Math.min(
          300000,
          30000 * 2 ** Math.max(0, (meta.pos_attempts ?? 1) - 1),
        ),
    ).toISOString();
    if (
      (meta.pos_attempts ?? 0) >= Number(config.retry_limit ?? 3) &&
      !state.escalations.some(
        (e) =>
          e.order_id === order.id && e.reason.startsWith("POS retry limit"),
      )
    ) {
      state.escalations.unshift({
        id: uid("esc"),
        order_id: order.id,
        customer: order.customer.name ?? "Customer",
        reason: `POS retry limit reached after ${meta.pos_attempts} attempts. Please check the order in the dashboard.`,
        status: "OPEN",
        created_at: new Date().toISOString(),
        priority: "High",
      });
    }
    audit(
      state,
      "pos.failed",
      "POS sync needs attention",
      error instanceof Error ? error.message : "POS unavailable",
      order.id,
      "error",
    );
    if (
      ["CONFIRMED", "PAYMENT_PENDING", "POS_SYNC_PENDING"].includes(
        order.status,
      )
    )
      order = transitionOrder(order, "POS_SYNC_FAILED");
  }
  state.order_metadata[order.id] = meta;
  return order;
}
async function afterConfirmation(
  state: TenantState,
  order: Order,
  session: Session | undefined,
  env: RuntimeEnv,
) {
  const meta = state.order_metadata[order.id] ?? {
    pos_status: "DASHBOARD_ONLY",
    notification_status: isDemo(env) ? "DEMO_PREVIEW" : "PENDING",
    demo: isDemo(env),
  };
  state.order_metadata[order.id] = meta;
  for (const candidate of session?.pending_corrections ?? []) {
    const memory = extractCorrection({
      merchant_id: state.merchant.id,
      language: state.merchant.language,
      ...candidate,
      confirmed_by_customer: true,
    });
    if (memory) {
      const existing = state.memories.find(
        (m) =>
          m.observed_text === memory.observed_text &&
          JSON.stringify(m.corrected_interpretation) ===
            JSON.stringify(memory.corrected_interpretation),
      );
      if (existing)
        state.memories[state.memories.indexOf(existing)] =
          mergeObservation(existing);
      else state.memories.unshift(memory);
      audit(
        state,
        "memory.created",
        "Correction learned",
        memory.observed_text,
        order.id,
        "success",
      );
    }
  }
  if (session) {
    const used = new Set(session.turns.flatMap((t) => t.memories_used ?? []));
    state.memories = state.memories.map((memory) => {
      if (!used.has(memory.id)) return memory;
      const meaning = memory.corrected_interpretation;
      const matched = order.items.some(
        (item) =>
          item.catalog_item_id ===
            (meaning.product ?? meaning.catalog_item_id) &&
          (!(meaning.modifier ?? meaning.modifier_id) ||
            item.modifiers.some(
              (m) =>
                m.modifier_id === (meaning.modifier ?? meaning.modifier_id),
            )),
      );
      return recordMemoryUse(memory, matched);
    });
    session.pending_corrections = [];
    session.status = "COMPLETED";
  }
  meta.delivery_status = "PENDING";
  if (order.status === "CONFIRMED")
    order = transitionOrder(order, "PAYMENT_PENDING");
  audit(
    state,
    "order.confirmed",
    "Order confirmed",
    `${order.external_reference} · $${order.total.toFixed(2)} MXN`,
    order.id,
    "success",
  );
  return order;
}
async function deliverPendingOrder(
  repo: Repository,
  merchantId: string,
  orderId: string,
  env: RuntimeEnv,
  _origin = "",
  returnUrls?: { success: string; cancel: string },
): Promise<Order | undefined> {
  const loaded = await repo.loadByMerchant(merchantId);
  if (!loaded) return;
  const state = loaded.state;
  const meta = state.order_metadata[orderId];
  if (meta?.delivery_status !== "PENDING") return findOrder(state, orderId);
  meta.delivery_status = "PROCESSING";
  if (!(await repo.saveTrusted(merchantId, loaded.revision, state))) return;
  let order = findOrder(state, orderId);
  try {
    order = await syncOrder(state, order, env);
    if (env.STRIPE_SECRET_KEY) {
      try {
        const checkout = await createCheckout(order, env, returnUrls);
        meta.checkout_id = checkout.id;
        meta.checkout_url = checkout.url;
        if (order.status === "CONFIRMED")
          order = transitionOrder(order, "PAYMENT_PENDING");
        audit(
          state,
          "payment.created",
          "Payment link created",
          order.external_reference,
          order.id,
          "success",
        );
      } catch (error) {
        audit(
          state,
          "payment.error",
          "Payment link needs attention",
          String(error instanceof Error ? error.message : error),
          order.id,
          "error",
        );
      }
    } else if (order.status === "CONFIRMED")
      order = transitionOrder(order, "PAYMENT_PENDING");
    if (
      !env.CUSTOMER_APP_ORIGIN &&
      env.TWILIO_ACCOUNT_SID &&
      state.settings.notifications.whatsapp
    ) {
      try {
        const sent = await sendWhatsApp(order, meta.checkout_url, env);
        meta.notification_status = sent.status.toUpperCase();
        audit(
          state,
          "notification.sent",
          "WhatsApp queued",
          sent.id,
          order.id,
          "success",
        );
      } catch (error) {
        meta.notification_status = "FAILED";
        audit(
          state,
          "notification.failed",
          "WhatsApp needs attention",
          String(error instanceof Error ? error.message : error),
          order.id,
          "error",
        );
      }
    }

    meta.delivery_status = "DONE";
    replaceOrder(state, order);
  } catch (error) {
    meta.delivery_status = "FAILED";
    audit(
      state,
      "delivery.failed",
      "Order delivery needs attention",
      error instanceof Error ? error.message : "Delivery failed",
      orderId,
      "error",
    );
  }
  // Merge delivery metadata into any unrelated edits that arrived while providers ran.
  for (let attempt = 0; attempt < 3; attempt++) {
    const latest = await repo.loadByMerchant(merchantId);
    if (!latest) return order;
    const latestOrder = findOrder(latest.state, orderId);
    latest.state.order_metadata[orderId] = {
      ...latest.state.order_metadata[orderId],
      ...meta,
      // A provider snapshot must never restore a revoked or replaced capability.
      customer_link: latest.state.order_metadata[orderId]?.customer_link,
      receipt_link: latest.state.order_metadata[orderId]?.receipt_link,
      billing: latest.state.order_metadata[orderId]?.billing,
      receipt_consent: latest.state.order_metadata[orderId]?.receipt_consent,
      receipt_notification:
        latest.state.order_metadata[orderId]?.receipt_notification,
    };
    if (
      latestOrder.revision ===
        loaded.state.orders.find((o) => o.id === orderId)?.revision ||
      latestOrder.status === "PAYMENT_PENDING"
    )
      replaceOrder(latest.state, order);
    const ids = new Set(latest.state.events.map((e) => e.id));
    latest.state.events = [
      ...state.events.filter((e) => !ids.has(e.id)),
      ...latest.state.events,
    ].slice(0, 500);
    if (await repo.saveTrusted(merchantId, latest.revision, latest.state)) {
      if (env.CUSTOMER_APP_ORIGIN)
        await sendPendingCustomerReceipt(repo, merchantId, orderId, env);
      return findOrder(latest.state, orderId);
    }
  }
  return order;
}
async function processTurn(
  state: TenantState,
  session: Session,
  utterance: string,
  env: RuntimeEnv,
  _origin = "",
  proposedOperations?: Operation[],
) {
  let order = findOrder(state, session.order_id);
  const wasConfirmed = [
    "CONFIRMED",
    "PAYMENT_PENDING",
    "POS_SYNC_PENDING",
    "POS_SYNCED",
    "POS_SYNC_FAILED",
  ].includes(order.status);
  if (
    ![
      "DRAFT",
      "AWAITING_CLARIFICATION",
      "AWAITING_CONFIRMATION",
      "CONFIRMED",
      "PAYMENT_PENDING",
      "POS_SYNC_PENDING",
      "POS_SYNCED",
      "POS_SYNC_FAILED",
    ].includes(order.status) ||
    order.payment_status !== "PENDING"
  )
    throw new HttpError(
      409,
      "This order needs the restaurant team before it can be changed.",
    );
  const memory = retrieveMemories(state.memories, {
    merchant_id: state.merchant.id,
    query: utterance,
    catalog: state.catalog,
    catalog_item_ids: state.catalog.map((i) => i.id),
  });
  const start = Date.now();
  const config = state.settings.model;
  const key = String(config.api_key ?? env.DEEPSEEK_API_KEY ?? "");
  let result: {
    operations: Operation[];
    reply: string;
    correction?: {
      observed_text: string;
      previous_interpretation: JsonObject;
      corrected_interpretation: JsonObject;
    };
  };
  let model = "Demo interpreter";
  if (proposedOperations) {
    result = { operations: proposedOperations, reply: "" };
    model = "Voice tool structured operations";
  } else if (isDemo(env) && !key)
    result = interpretDemo(utterance, order, state.catalog, memory);
  else {
    if (
      !key &&
      !["self-hosted", "self_hosted"].includes(String(config.hosting))
    )
      throw new HttpError(
        503,
        "Connect an AI model before using live interpretation.",
      );
    const adapter = new OpenAICompatibleAdapter({
      provider: z
        .enum(["deepseek", "qwen", "ollama", "vllm", "sglang", "generic"])
        .parse(config.provider ?? "deepseek"),
      endpoint: String(config.endpoint ?? "https://api.deepseek.com/v1"),
      model: String(config.model ?? "deepseek-flash"),
      apiKey: key,
      timeoutMs: Number(config.timeout_ms ?? 10000),
    });
    const fallback =
      config.fallback_enabled && env.DEEPSEEK_API_KEY
        ? new OpenAICompatibleAdapter({
            provider: "deepseek",
            endpoint: "https://api.deepseek.com",
            model: "deepseek-flash",
            apiKey: env.DEEPSEEK_API_KEY,
          })
        : undefined;
    const gateway = new Gateway(adapter, {
      fallback,
      allowFallback: config.fallback_enabled === true,
      onFallback: (event) =>
        audit(
          state,
          "model.fallback",
          "Fallback model used",
          event.reason,
          order.id,
          "warning",
          event,
        ),
    });
    const generated = await gateway.interpret({
      utterance,
      order,
      catalog: state.catalog,
      memories: memory,
      recent_context: session.turns
        .slice(-6)
        .map((t) => ({ role: t.role, content: t.text })),
    });
    result = generated;
    model = generated.model;
  }
  if (!isDemo(env) && state.settings.agent.enabled === false)
    throw new HttpError(
      409,
      "Phone ordering is paused. Please contact the restaurant team.",
    );
  const pickupOperation = result.operations.find(
    (op) => op.action === "set_pickup_time",
  );
  if (
    !isDemo(env) &&
    pickupOperation?.action === "set_pickup_time" &&
    pickupOperation.scheduled_for &&
    Date.parse(pickupOperation.scheduled_for) <= Date.now()
  )
    throw new HttpError(422, "Choose a pickup time in the future.");
  const proposedOrder =
    pickupOperation?.action === "set_pickup_time"
      ? {
          ...order,
          fulfillment: {
            ...order.fulfillment,
            scheduled_for: pickupOperation.scheduled_for,
          },
        }
      : order;
  if (
    !orderingAllowed(state, env, proposedOrder) &&
    result.operations.some((op) =>
      ["add_item", "modify_item", "change_quantity", "confirm_order"].includes(
        op.action,
      ),
    )
  ) {
    const question =
      state.settings.agent.after_hours === "scheduled_orders"
        ? "We are closed right now. What pickup time during opening hours would you like?"
        : "We are currently closed for ordering. Please call during business hours.";
    result = {
      operations: [{ action: "request_clarification", question }],
      reply: question,
    };
  }
  // A model cannot invent customer consent: confirmation must also match the actual utterance.
  if (
    result.operations.some((op) => op.action === "confirm_order") &&
    !isExplicitConfirmation(utterance)
  )
    throw new HttpError(
      422,
      "Please explicitly confirm the complete order before it is submitted.",
    );
  if (wasConfirmed) {
    const modifying = result.operations.some(
      (op) =>
        !["confirm_order", "request_clarification", "escalate_issue"].includes(
          op.action,
        ),
    );
    if (modifying) {
      const meta = state.order_metadata[order.id];
      if (meta?.delivery_status === "PROCESSING")
        throw new HttpError(
          409,
          "Order delivery is in progress. Please try again in a moment.",
        );
      if (meta?.pos_status === "SYNCED")
        throw new HttpError(
          409,
          "This order has reached your POS. The team needs to approve changes because this adapter does not support updates.",
        );
      if (meta?.checkout_id) await expireCheckout(meta.checkout_id, env);
      if (meta) {
        delete meta.checkout_id;
        delete meta.checkout_url;
        meta.delivery_status = "DONE";
      }
      session.status = "ACTIVE";
    } else if (result.operations.every((op) => op.action === "confirm_order"))
      return {
        order: metadata(state, order),
        reply: `Your order is already confirmed: ${summary(order)}`,
        operations: [],
        turns: session.turns,
        memories_used: [],
      };
  }
  const before = order;
  order = applyOperations(
    order,
    result.operations,
    state.catalog,
    rules(state),
  );
  const previousUtterance = [...session.turns]
    .reverse()
    .find((t) => t.role === "user")?.text;
  const previousOperation = [...session.turns]
    .reverse()
    .find((t) => t.role === "assistant" && t.operations?.length)?.operations;
  let correction = result.correction;
  // Live models propose operations only. Detect repairs from validated before/after evidence.
  if (
    !correction &&
    /^no\b|i meant|quise decir|dije/i.test(utterance) &&
    detectCorrection({
      utterance,
      previous_utterance: previousUtterance,
      previous_operation: previousOperation,
      before,
      after: order,
    })
  ) {
    const changed = order.items.find((item) => {
      const prior = before.items.find((old) => old.line_id === item.line_id);
      return (
        prior &&
        (prior.catalog_item_id !== item.catalog_item_id ||
          JSON.stringify(prior.modifiers) !== JSON.stringify(item.modifiers))
      );
    });
    const prior =
      changed && before.items.find((item) => item.line_id === changed.line_id);
    if (changed && prior && previousUtterance)
      correction = {
        observed_text: previousUtterance,
        previous_interpretation: {
          product: prior.catalog_item_id,
          ...(prior.modifiers[0]
            ? { modifier: prior.modifiers[0].modifier_id }
            : {}),
        },
        corrected_interpretation: {
          product: changed.catalog_item_id,
          ...(changed.modifiers[0]
            ? { modifier: changed.modifiers[0].modifier_id }
            : {}),
        },
      };
  }
  if (
    correction &&
    (/abena/i.test(previousUtterance ?? "") ||
      /^no\b|i meant|quise decir|dije/i.test(utterance))
  )
    session.pending_corrections.push({
      ...correction,
      observed_text: previousUtterance ?? correction.observed_text,
    });
  if (
    order.items.length &&
    !["AWAITING_CLARIFICATION", "ESCALATED", "CANCELLED"].includes(order.status)
  )
    result.reply =
      order.status === "CONFIRMED"
        ? `Confirmed: ${summary(order)} Your order is saved.`
        : `${summary(order)} Anything else, or would you like to confirm?`;
  const createdAt = new Date().toISOString();
  session.turns.push(
    { id: uid("turn"), role: "user", text: utterance, created_at: createdAt },
    {
      id: uid("turn"),
      role: "assistant",
      text: result.reply,
      created_at: createdAt,
      operations: result.operations,
      latency_ms: Date.now() - start,
      model,
      memories_used: memory.map((m) => m.id),
    },
  );
  audit(
    state,
    order.status === "AWAITING_CLARIFICATION"
      ? "order.clarification"
      : "order.turn",
    order.status === "AWAITING_CLARIFICATION"
      ? "Clarification requested"
      : "Order updated",
    utterance,
    order.id,
    "info",
    {
      before,
      operations: result.operations,
      after: order,
      memories: memory.map((m) => m.id),
      model,
    },
  );
  if (order.status === "ESCALATED") {
    state.escalations.unshift({
      id: uid("esc"),
      order_id: order.id,
      customer: order.customer.name ?? "Caller",
      reason: order.notes.at(-1) ?? "Customer requested a person",
      status: "OPEN",
      created_at: createdAt,
      priority: "High",
    });
    session.status = "ESCALATED";
  }
  if (order.status === "CONFIRMED")
    order = await afterConfirmation(state, order, session, env);
  replaceOrder(state, order);
  return {
    order: metadata(state, order),
    reply: result.reply,
    operations: result.operations,
    turns: session.turns,
    memories_used: memory,
  };
}
async function stripeWebhook(
  request: Request,
  env: RuntimeEnv,
  repo: Repository,
) {
  if (!env.STRIPE_WEBHOOK_SECRET)
    throw new HttpError(503, "Stripe webhook secret is not configured.");
  const raw = await request.text();
  if (
    !(await verifyStripeSignature(
      raw,
      request.headers.get("stripe-signature") ?? "",
      env.STRIPE_WEBHOOK_SECRET,
    ))
  )
    throw new HttpError(400, "Invalid Stripe signature.");
  const event = JSON.parse(raw) as {
    id: string;
    type: string;
    data: {
      object: {
        id: string;
        metadata?: { merchant_id?: string; order_id?: string };
        payment_status?: string;
        amount_total?: number;
        currency?: string;
      };
    };
  };
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type)
  )
    return json({ received: true, ignored: true });
  if (await repo.hasEvent(event.id))
    return json({ received: true, duplicate: true });
  const checkout = event.data.object;
  const merchantId = checkout.metadata?.merchant_id;
  const orderId = checkout.metadata?.order_id;
  if (!merchantId || !orderId)
    throw new HttpError(
      400,
      "Checkout merchant and order metadata are required.",
    );
  const stored = await repo.loadByMerchant(merchantId);
  if (!stored) throw new HttpError(404, "Merchant not found.");
  const order = findOrder(stored.state, orderId);
  const meta = stored.state.order_metadata[orderId];
  if (
    meta?.checkout_id !== checkout.id ||
    !validatePaidSession(checkout, order.total, order.currency)
  )
    throw new HttpError(
      400,
      "Checkout does not match the saved order amount, currency or session.",
    );
  if (order.payment_status !== "PAID") {
    replaceOrder(stored.state, transitionOrder(order, "PAID"));
    audit(
      stored.state,
      "payment.paid",
      "Payment received",
      order.external_reference,
      order.id,
      "success",
    );
    if (!(await repo.saveTrusted(merchantId, stored.revision, stored.state)))
      throw new HttpError(
        409,
        "Order is updating. Stripe will retry this event.",
      );
  }
  await repo.recordEvent(event.id, merchantId, "stripe", event.type);
  if (env.N8N_WEBHOOK_URL && env.N8N_WEBHOOK_SECRET) {
    try {
      const endpoint = new URL(env.N8N_WEBHOOK_URL);
      if (endpoint.protocol !== "https:")
        throw new Error("n8n webhook requires HTTPS");
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Ring-Orden-Secret": env.N8N_WEBHOOK_SECRET,
          "Idempotency-Key": event.id,
        },
        body: JSON.stringify({
          id: event.id,
          type: "payment.paid",
          merchant_id: merchantId,
          order_id: orderId,
          amount: order.total,
          currency: order.currency,
        }),
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new Error(`n8n HTTP ${response.status}`);
    } catch (error) {
      const latest = await repo.loadByMerchant(merchantId);
      if (latest) {
        audit(
          latest.state,
          "n8n.failed",
          "Payment workflow notification failed",
          error instanceof Error ? error.message : "n8n unavailable",
          orderId,
          "warning",
        );
        await repo.saveTrusted(merchantId, latest.revision, latest.state);
      }
    }
  }
  return json({ received: true });
}
async function handleCustomerVerificationRequest(
  request: Request,
  env: RuntimeEnv,
  repo: Repository,
): Promise<Response> {
  let origin: string;
  try {
    const parsed = new URL(String(env.CUSTOMER_APP_ORIGIN));
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      parsed.hostname,
    );
    if (
      (parsed.protocol !== "https:" &&
        !(loopback && parsed.protocol === "http:")) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    )
      throw new Error();
    origin = parsed.origin;
  } catch {
    throw new HttpError(503, "Customer verification is not configured.");
  }
  if (request.headers.get("Origin") !== origin)
    throw new HttpError(403, "Customer origin is not allowed.");
  const headers = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
    "Referrer-Policy": "no-referrer",
  };
  if (new URL(request.url).pathname !== "/api/customer/verify")
    return json({ error: "Endpoint not found." }, 404, headers);
  if (request.method === "OPTIONS")
    return new Response(null, { status: 204, headers });
  if (
    request.method !== "POST" ||
    new URL(request.url).pathname !== "/api/customer/verify"
  )
    return json({ error: "Endpoint not found." }, 404, headers);
  try {
    const body = await bodyOf(request);
    const token = z.string().min(80).max(1600).parse(body.token);
    const merchantId = readCustomerVerificationTenant(token);
    const stored = await repo.loadByMerchant(merchantId);
    if (!stored)
      throw new HttpError(401, "This verification link is invalid or expired.");
    const result = await completeCustomerVerification(stored.state, token);
    if (!(await repo.saveTrusted(merchantId, stored.revision, stored.state)))
      throw new HttpError(409, "Another update arrived. Please try again.");
    return json(result, 200, headers);
  } catch (error) {
    return json(
      {
        error:
          error instanceof HttpError
            ? error.message
            : "This verification link is invalid or expired.",
      },
      error instanceof HttpError ? error.status : 401,
      headers,
    );
  }
}

export async function handleRequest(
  request: Request,
  env: RuntimeEnv = {},
  repository?: Repository,
): Promise<Response> {
  try {
    const authentication = await handleMojoAuthRequest(request, env);
    if (authentication) return authentication;
    const url = new URL(request.url);
    const path = url.pathname
      .replace(/^\/api\/?/, "")
      .split("/")
      .filter(Boolean);
    const method = request.method;
    if (path[0] === "customer") {
      const repo = repository ?? repositoryFor(env);
      if (path[1] === "verify")
        return await handleCustomerVerificationRequest(request, env, repo);
      const capability = await handleCustomerCapability(request, env, repo);
      if (capability) return capability;
      return handleCustomerOrderRequest(request, env, repo, {
        rules,
        orderingAllowed,
        confirm: (state, order, environment) => {
          const session = state.sessions.find((s) => s.order_id === order.id);
          // Visual edits may differ from voice interpretation; do not learn unverified corrections.
          if (session) session.pending_corrections = [];
          return afterConfirmation(state, order, session, environment);
        },
        deliver: deliverPendingOrder,
      });
    }
    if (method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: { Allow: "GET, POST, PATCH, DELETE, OPTIONS" },
      });
    if (path[0] === "auth") validateMutationOrigin(request);
    if (path[0] === "auth" && path[1] === "config" && method === "GET") {
      const configured = Boolean(
        env.MOJOAUTH_ISSUER &&
          env.MOJOAUTH_AUDIENCE &&
          env.MOJOAUTH_JWKS_URL &&
          env.SESSION_SECRET,
      );
      return json(
        configured
          ? {
              provider: "mojoauth",
              issuer: env.MOJOAUTH_ISSUER,
              clientId: env.MOJOAUTH_AUDIENCE,
            }
          : { provider: null },
      );
    }
    if (path[0] === "auth" && path[1] === "session" && method === "POST") {
      const body = await bodyOf(request);
      const verified = await verifyMojoToken(
        z.string().min(20).parse(body.access_token),
        env,
      );
      const user = await linkMojoIdentity(verified, env);
      return json({ user }, 200, {
        "Set-Cookie": await makeSessionCookie(user, env),
      });
    }
    if (path[0] === "auth" && path[1] === "logout")
      return json({ ok: true }, 200, {
        "Set-Cookie":
          "ring_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0",
      });
    if (!repository) await prepareSupabaseMigration(env);
    const repo = repository ?? repositoryFor(env);
    if (path[0] === "webhooks" && path[1] === "stripe")
      return await stripeWebhook(request, env, repo);
    if (
      path[0] === "webhooks" &&
      path[1] === "elevenlabs" &&
      path.length === 2 &&
      method === "POST"
    )
      return await handleElevenLabsEvent(request, env, repo);
    validateMutationOrigin(request);
    let trustedTool = false;
    let identity: Identity;
    let merchantId: string;
    let role: MerchantRole = "OWNER";
    if (path[0] === "tools") {
      if (
        !configuredAgentSecret(env) ||
        request.headers.get("authorization") !==
          `Bearer ${configuredAgentSecret(env)}` ||
        !env.AGENT_MERCHANT_ID
      )
        throw new HttpError(401, "Invalid agent tool authentication.");
      trustedTool = true;
      merchantId = env.AGENT_MERCHANT_ID;
      identity = {
        id: "agent",
        name: "Voice agent",
        email: "",
        provider: "sites",
      };
    } else {
      identity = await identityFromRequest(request, env);
      if (path[0] === "team" && path[1] === "accept" && method === "POST") {
        if (identity.email_verified !== true || !identity.email)
          throw new HttpError(
            403,
            "A verified email address is required to accept this invitation.",
          );
        const body = await bodyOf(request);
        const token = z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .parse(body.token);
        const accepted = await repo.acceptInvitation(
          await sha256Hex(token),
          identity.id,
          identity.email,
        );
        if (!accepted)
          throw new HttpError(
            403,
            "This invitation is expired, already used, or belongs to another email address.",
          );
        const invited = await repo.load(accepted.merchant_id, identity.id);
        if (invited) {
          const member = invited.state.team.find((m) => m.id === accepted.id);
          if (member) {
            member.id = identity.id;
            member.status = "Active";
            member.name = identity.name || accepted.name;
          } else
            invited.state.team.push({
              id: identity.id,
              name: identity.name || accepted.name,
              email: identity.email,
              role: accepted.role,
              status: "Active",
            });
          audit(
            invited.state,
            "team.joined",
            "Teammate joined",
            identity.email,
          );
          await repo.save(
            accepted.merchant_id,
            identity.id,
            invited.revision,
            invited.state,
          );
        }
        return json(
          {
            accepted: true,
            merchant_id: accepted.merchant_id,
            role: accepted.role,
          },
          200,
          {
            "Set-Cookie": `ring_workspace=${encodeURIComponent(accepted.merchant_id)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=2592000`,
          },
        );
      }
      const memberships = await repo.listMemberships(identity.id);
      const hint =
        request.headers.get("x-ring-orden-workspace") ??
        request.headers
          .get("cookie")
          ?.split(";")
          .map((v) => v.trim())
          .find((v) => v.startsWith("ring_workspace="))
          ?.slice(15);
      const selected = hint
        ? memberships.find((m) => m.merchant_id === decodeURIComponent(hint))
        : memberships[0];
      if (hint && !selected)
        throw new HttpError(
          403,
          "You do not have access to this merchant workspace.",
        );
      merchantId = selected?.merchant_id ?? (await tenantIdFor(identity.id));
      role = selected?.role ?? "OWNER";
    }
    let stored = trustedTool
      ? await repo.loadByMerchant(merchantId)
      : await repo.load(merchantId, identity.id);
    if (!stored) {
      if (trustedTool) throw new HttpError(404, "Agent merchant not found.");
      await repo.create(
        merchantId,
        identity.id,
        seedTenant(merchantId, identity, isDemo(env)),
      );
      stored = await repo.load(merchantId, identity.id);
    }
    if (!stored)
      throw new HttpError(503, "Merchant workspace could not be initialized.");
    const state = stored.state;
    // Recover legacy upload provenance before any later mutation can prune old request-cache entries.
    listMenuImports(state);
    if (method === "GET") {
      if (!trustedTool) guardMerchantRoute(role, path, method);
      if (path[0] === "customers") {
        const result = handleCustomerMerchant(state, path, method, {}, role);
        // Recognition may materialize records from canonical order contacts.
        const saved = await repo.save(
          merchantId,
          identity.id,
          stored.revision,
          state,
        );
        if (!saved)
          throw new HttpError(
            409,
            "Another update just arrived. Please try again.",
          );
        return json(result);
      }
      if (path[0] === "menu" && path[1] === "image" && path[2] === "status") {
        if (role !== "OWNER")
          throw new HttpError(403, "Only the owner can import products.");
        return json({ configured: Boolean(env.FIRECRAWL_API_KEY) });
      }
      if (path[0] === "menu" && path[1] === "imports" && path.length === 2) {
        if (role !== "OWNER")
          throw new HttpError(403, "Only the owner can manage menu uploads.");
        return json({ imports: listMenuImports(state) });
      }
      if (path[0] === "bootstrap") {
        const workspace = bootstrap(state, identity, env, role);
        workspace.orders = workspace.orders.map((order) =>
          redactOrderForRole(order, role),
        );
        return json(redactWorkspace(workspace, role));
      }
      if (path[0] === "orders") {
        const active = (order: Order) =>
          ![
            "DRAFT",
            "AWAITING_CLARIFICATION",
            "AWAITING_CONFIRMATION",
            "COMPLETED",
            "CANCELLED",
            "REFUND_PENDING",
            "REFUNDED",
          ].includes(order.status);
        if (path[1]) {
          const order = findOrder(state, path[1]);
          if (path[2] === "billing" && path.length === 3) {
            if (role !== "OWNER")
              throw new HttpError(
                403,
                "Only the owner can view billing details.",
              );
            return json(
              state.order_metadata[order.id]?.billing ?? {
                revision: 0,
                details: null,
              },
            );
          }
          if (role === "STAFF" && !active(order))
            throw new HttpError(403, "Staff can only access active orders.");
          return json(redactOrderForRole(metadata(state, order), role));
        }
        return json(
          state.orders
            .filter((order) => role !== "STAFF" || active(order))
            .map((order) => redactOrderForRole(metadata(state, order), role)),
        );
      }
      if (path[0] === "sessions" && path[1]) {
        const session = state.sessions.find((s) => s.id === path[1]);
        if (!session) throw new HttpError(404, "Conversation not found.");
        if (
          role === "STAFF" &&
          [
            "DRAFT",
            "AWAITING_CLARIFICATION",
            "AWAITING_CONFIRMATION",
            "COMPLETED",
            "CANCELLED",
            "REFUND_PENDING",
            "REFUNDED",
          ].includes(findOrder(state, session.order_id).status)
        )
          throw new HttpError(403, "Staff can only access active call state.");
        return json(
          role === "STAFF"
            ? {
                id: session.id,
                order_id: session.order_id,
                status: session.status,
                created_at: session.created_at,
              }
            : {
                ...session,
                order: redactOrderForRole(
                  metadata(state, findOrder(state, session.order_id)),
                  role,
                ),
              },
        );
      }
      if (path[0] === "health")
        return json({
          status: "ok",
          database: storageStatus(env),
          mode: isDemo(env) ? "demo" : "live",
        });
      throw new HttpError(404, "Endpoint not found.");
    }
    if (
      path[0] === "menu" &&
      path[1] === "image" &&
      path[2] === "preview" &&
      method === "POST"
    ) {
      if (trustedTool || role !== "OWNER")
        throw new HttpError(403, "Only the owner can import products.");
      return json(
        await extractMenuPhoto(
          request,
          env.FIRECRAWL_API_KEY ?? "",
          state.merchant.currency || "MXN",
        ),
      );
    }
    const body = await bodyOf(request);
    if (!trustedTool) guardMerchantRoute(role, path, method, body);
    let result: unknown;
    let status = 200;
    const requestId =
      request.headers.get("Idempotency-Key") ??
      (typeof body.request_id === "string" ? body.request_id : undefined);
    // A capability URL is returned only once; never retain it in the response cache.
    const issuesCustomerLink =
      path[0] === "customers" ||
      (method === "POST" &&
        ((path[0] === "orders" && ["customer-link", "receipt-link"].includes(path[2])) ||
          (path[0] === "tools" && path[1] === "customer_link")));
    const requestKey =
      requestId && !issuesCustomerLink
        ? `${identity.id}:${method}:${url.pathname}:${requestId}`
        : undefined;
    const digest = requestKey
      ? Array.from(
          new Uint8Array(
            await crypto.subtle.digest(
              "SHA-256",
              new TextEncoder().encode(JSON.stringify(body)),
            ),
          ),
        )
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("")
      : "";
    if (requestKey && state.requests[requestKey]) {
      const cached = state.requests[requestKey];
      if (cached.body_hash !== digest)
        throw new HttpError(
          409,
          "This request ID has already been used for different input.",
        );
      return json(cached.result);
    }
    const legacyReceiptRetry =
      !!env.CUSTOMER_APP_ORIGIN &&
      path[0] === "orders" &&
      path[2] === "action" &&
      body.action === "retry_notification";
    if (legacyReceiptRetry && method === "POST") {
      if (role !== "OWNER")
        throw new HttpError(403, "Only the owner can send receipts.");
      const order = findOrder(state, path[1]);
      if (
        !state.order_metadata[order.id]?.receipt_consent ||
        state.order_metadata[order.id].receipt_consent?.phone !==
          order.customer.phone
      )
        throw new HttpError(
          422,
          "Record customer WhatsApp consent with the receipt controls first.",
        );
      const notification = await sendPendingCustomerReceipt(
        repo,
        merchantId,
        order.id,
        env,
        true,
      );
      const latest = await repo.loadByMerchant(merchantId);
      return json({
        order: metadata(latest!.state, findOrder(latest!.state, order.id)),
        notification,
      });
    }
    if (path[0] === "customers") {
      if (path[2] === "verification-link" && method === "POST") {
        if (role !== "OWNER")
          throw new HttpError(
            403,
            "Only the owner may issue verification links.",
          );
        const session = state.sessions.find((s) => s.id === body.session_id);
        if (!session) throw new HttpError(404, "Conversation not found.");
        const context = (await handleCustomerTool(
          state,
          "get_customer_context",
          {},
          session,
          env,
        )) as Record<string, unknown>;
        if (context.customer_id !== path[1])
          throw new HttpError(
            404,
            "Customer does not match this conversation.",
          );
        result = await issueCustomerVerificationChallenge(state, session, env);
        status = 201;
      } else result = handleCustomerMerchant(state, path, method, body, role);
    } else if (
      path[0] === "orders" &&
      path.length === 3 &&
      path[2] === "receipt-send" &&
      method === "POST"
    ) {
      if (role !== "OWNER")
        throw new HttpError(403, "Only the owner can send receipts.");
      z.object({ customer_opted_in: z.literal(true) })
        .strict()
        .parse(body);
      const order = findOrder(state, path[1]);
      recordReceiptConsent(state, order, true);
      if (!(await repo.save(merchantId, identity.id, stored.revision, state)))
        throw new HttpError(409, "The order changed. Refresh before sending.");
      return json(
        await sendPendingCustomerReceipt(repo, merchantId, order.id, env, true),
      );
    } else if (
      path[0] === "orders" &&
      path.length === 3 &&
      ["customer-link", "receipt-link"].includes(path[2]) &&
      ["POST", "DELETE"].includes(method)
    ) {
      if (role !== "OWNER")
        throw new HttpError(
          403,
          "Only the owner can manage customer order links.",
        );
      const order = findOrder(state, path[1]);
      if (path[2] === "receipt-link") {
      result =
        method === "DELETE"
          ? path[2] === "receipt-link"
            ? revokeCustomerReceiptLink(state, order.id)
            : revokeCustomerOrderLink(state, order.id)
          : await (path[2] === "receipt-link"
              ? issueCustomerReceiptLink(state, order, env)
              : issueCustomerOrderLink(state, order, env));
      } else {
      const purpose = z
        .enum(["order", "recovery", "receipt", "billing"])
        .parse(body.purpose ?? "order");
      if (method === "DELETE")
        result =
          purpose === "receipt" || purpose === "billing"
            ? revokeCustomerCapabilityLink(state, order.id, purpose)
            : revokeCustomerOrderLink(state, order.id);
      else if (purpose === "receipt" || purpose === "billing") {
        if (
          purpose === "receipt" &&
          (order.status !== "COMPLETED" || order.payment_status !== "PAID")
        )
          throw new HttpError(
            409,
            "A receipt link is available after the paid order is completed.",
          );
        result = await issueCustomerCapabilityLink(state, order, purpose, env);
      } else
        result =
          purpose === "recovery"
            ? await issueRecoveryLink(state, order, env)
            : await issueCustomerOrderLink(state, order, env);
      }
      status = method === "POST" ? 201 : 200;
      audit(
        state,
        "order.customer_link",
        method === "DELETE" ? "Customer link revoked" : "Customer link created",
        order.external_reference,
        order.id,
      );
    } else if (
      method === "POST" &&
      ((path[0] === "sessions" && !path[1]) ||
        (path[0] === "tools" && path[1] === "create_session"))
    ) {
      const order = createOrder(merchantId);
      order.source = isDemo(env) ? "demo" : "voice";
      const recognizedPhone = body.phone ? normalizePhone(body.phone) : null;
      if (body.phone && !recognizedPhone)
        throw new HttpError(
          422,
          "Use an international phone number beginning with +.",
        );
      order.customer = {
        name: z.string().max(120).optional().parse(body.name) ?? null,
        phone: recognizedPhone,
      };
      order.external_reference = `RO-${1049 + state.orders.length - 14}`;
      replaceOrder(state, order);
      state.order_metadata[order.id] = {
        pos_status: "DASHBOARD_ONLY",
        notification_status: "PENDING",
        demo: isDemo(env),
      };
      const session: Session = {
        id: uid("session"),
        ...(trustedTool && typeof body.request_id === "string"
          ? { provider_conversation_id: body.request_id }
          : {}),
        order_id: order.id,
        turns: [
          {
            id: uid("turn"),
            role: "assistant",
            text: `¡Hola! Gracias por llamar a ${state.merchant.name}. ¿Qué te gustaría pedir?`,
            created_at: new Date().toISOString(),
          },
        ],
        created_at: new Date().toISOString(),
        status: "ACTIVE",
        pending_corrections: [],
      };
      state.sessions.unshift(session);
      result = {
        ...session,
        session_id: session.id,
        order: metadata(state, order),
        customer_context: await handleCustomerTool(
          state,
          "get_customer_context",
          {},
          session,
          env,
        ),
        language_policy: {
          initial: "es-MX",
          supported: ["es-MX", "en-US", "zh-CN"],
        },
      };
      status = 201;
    } else if (
      path[0] === "sessions" &&
      path[2] === "turn" &&
      method === "POST"
    ) {
      const session = state.sessions.find((s) => s.id === path[1]);
      if (!session) throw new HttpError(404, "Conversation not found.");
      result = await processTurn(
        state,
        session,
        z.string().trim().min(1).max(1500).parse(body.utterance),
        env,
      );
    } else if (path[0] === "orders" && !path[1] && method === "POST") {
      let order = createOrder(merchantId);
      order.source = isDemo(env) ? "demo" : "dashboard";
      order.customer = z
        .object({
          name: z.string().max(120).nullable(),
          phone: z
            .string()
            .regex(/^\+\d{8,15}$/)
            .nullable(),
        })
        .parse({
          name: body.customer?.name ?? null,
          phone: body.customer?.phone ?? null,
        });
      if (body.fulfillment)
        order.fulfillment = z
          .object({
            type: z.enum(["pickup", "dine_in"]),
            scheduled_for: z.string().datetime({ offset: true }).nullable(),
          })
          .parse(body.fulfillment);
      if ((body.items ?? []).length && !orderingAllowed(state, env, order))
        throw new HttpError(
          409,
          "The restaurant is currently closed for ordering.",
        );
      for (const item of z
        .array(
          z.object({
            catalog_item_id: z.string(),
            quantity: z.number().int().min(1).max(20).optional(),
            modifier_ids: z.array(z.string()).optional(),
          }),
        )
        .max(30)
        .parse(body.items ?? []))
        order = applyOperation(
          order,
          { action: "add_item", ...item },
          state.catalog,
          rules(state),
        );
      replaceOrder(state, order);
      state.order_metadata[order.id] = {
        pos_status: "DASHBOARD_ONLY",
        notification_status: "PENDING",
        demo: isDemo(env),
      };
      result = metadata(state, order);
      status = 201;
    } else if (
      path[0] === "orders" &&
      path[2] === "action" &&
      method === "POST"
    ) {
      let order = findOrder(state, path[1]);
      const action = z
        .enum([
          "prepare",
          "ready",
          "complete",
          "cancel",
          "retry_pos",
          "demo_pay",
          "checkout",
          "confirm",
          "retry_notification",
        ])
        .parse(body.action);
      let checkoutUrl: string | undefined;
      if (action === "prepare") order = transitionOrder(order, "PREPARING");
      if (action === "ready") order = transitionOrder(order, "READY");
      if (action === "complete") order = transitionOrder(order, "COMPLETED");
      if (action === "cancel") {
        const meta = state.order_metadata[order.id];
        if (order.payment_status !== "PAID" && meta?.checkout_id) {
          await expireCheckout(meta.checkout_id, env);
          delete meta.checkout_id;
          delete meta.checkout_url;
        }
        order = transitionOrder(
          order,
          order.payment_status === "PAID" ? "REFUND_PENDING" : "CANCELLED",
        );
      }
      if (action === "confirm") {
        if (body.confirmed !== true)
          throw new HttpError(
            422,
            "Explicit customer confirmation is required.",
          );
        recordReceiptConsent(
          state,
          order,
          z.boolean().optional().parse(body.whatsapp_receipt),
        );
        if (
          ["DRAFT", "AWAITING_CLARIFICATION", "AWAITING_CONFIRMATION"].includes(
            order.status,
          )
        ) {
          if (!orderingAllowed(state, env, order))
            throw new HttpError(
              409,
              "The restaurant is currently closed. Choose a future pickup during business hours if scheduled orders are enabled.",
            );
          order = applyOperation(
            order,
            { action: "confirm_order", confirmed: true },
            state.catalog,
            rules(state),
          );
          order = await afterConfirmation(
            state,
            order,
            undefined,
            env,
          );
        } else if (
          ["CANCELLED", "REFUNDED", "REFUND_PENDING"].includes(order.status)
        )
          throw new HttpError(409, "This order cannot be confirmed.");
      }
      if (action === "demo_pay") {
        if (!isDemo(env) || order.source !== "demo")
          throw new HttpError(
            403,
            "Simulated payment is available for demo orders only.",
          );
        order = transitionOrder(order, "PAID");
        audit(
          state,
          "payment.demo",
          "Demo payment simulated",
          order.external_reference,
          order.id,
          "success",
        );
      }
      if (action === "retry_pos") {
        if (state.order_metadata[order.id]?.pos_status === "RETRYING")
          throw new HttpError(
            409,
            "An automatic POS retry is already running.",
          );
        order = await syncOrder(state, order, env);
      }
      if (action === "checkout") {
        if (
          ![
            "CONFIRMED",
            "PAYMENT_PENDING",
            "POS_SYNC_FAILED",
            "POS_SYNCED",
          ].includes(order.status) ||
          order.payment_status === "PAID"
        )
          throw new HttpError(
            409,
            "Only confirmed unpaid orders can create checkout.",
          );
        const checkout = await createCheckout(order, env);
        state.order_metadata[order.id] = {
          ...state.order_metadata[order.id],
          checkout_id: checkout.id,
          checkout_url: checkout.url,
        };
        checkoutUrl = checkout.url;
      }
      if (action === "retry_notification") {
        const sent = await sendWhatsApp(
          order,
          state.order_metadata[order.id]?.checkout_url,
          env,
        );
        state.order_metadata[order.id].notification_status =
          sent.status.toUpperCase();
      }
      replaceOrder(state, order);
      if (action === "complete") await queueCompletedReceipts(state, env);
      audit(
        state,
        "order.action",
        "Order status updated",
        `${order.external_reference}: ${order.status}`,
        order.id,
        "success",
      );
      result = {
        order: redactOrderForRole(metadata(state, order), role),
        ...(role === "OWNER" ? { checkout_url: checkoutUrl } : {}),
      };
    } else if (
      path[0] === "menu" &&
      path[1] === "import" &&
      method === "POST"
    ) {
      const batch = z
        .object({
          items: z.array(ReviewedMenuItemSchema).min(1).max(100),
          request_id: z.string().uuid().optional(),
          source: z.enum(["photo", "csv"]).default("photo"),
          label: z.string().trim().min(1).max(180).optional(),
          replace_import_ids: z
            .array(z.string().min(1).max(160))
            .max(100)
            .default([]),
        })
        .strict()
        .parse(body);
      const added = batch.items.map((item) =>
        CatalogItemSchema.parse({ ...item, id: uid("item"), modifiers: [] }),
      );
      const imported = addMenuImport(state, added, {
        ...batch,
        label:
          batch.label ?? (batch.source === "csv" ? "CSV menu" : "Menu photo"),
      });
      audit(
        state,
        "menu.imported",
        batch.replace_import_ids.length
          ? "Menu uploads replaced"
          : "Menu products added",
        `${added.length} reviewed products added from ${imported.label}.`,
      );
      result = { items: added, count: added.length, import: imported };
      status = 201;
    } else if (
      path[0] === "menu" &&
      path[1] === "imports" &&
      path.length === 4 &&
      method === "POST" &&
      ["unload", "restore"].includes(path[3])
    ) {
      z.object({ request_id: z.string().uuid().optional() })
        .strict()
        .parse(body);
      result =
        path[3] === "unload"
          ? unloadMenuImport(state, path[2])
          : restoreMenuImport(state, path[2]);
      const changed = result as { import: { label: string }; count: number };
      if (changed.count)
        audit(
          state,
          `menu.${path[3]}`,
          path[3] === "unload"
            ? "Menu upload unloaded"
            : "Menu upload restored",
          `${changed.import.label}: ${changed.count} products`,
        );
    } else if (path[0] === "menu" && method === "PATCH") {
      const index = state.catalog.findIndex((item) => item.id === path[1]);
      if (index < 0) throw new HttpError(404, "Menu item not found.");
      const changes = z
        .object({
          name: z.string().min(1).max(120).optional(),
          description: z.string().max(2000).optional(),
          price: z.number().finite().nonnegative().max(100000).optional(),
          available: z.boolean().optional(),
          category: z.string().min(1).max(80).optional(),
          modifiers: CatalogItemSchema.shape.modifiers.optional(),
        })
        .strict()
        .parse(body);
      state.catalog[index] = CatalogItemSchema.parse({
        ...state.catalog[index],
        ...changes,
      });
      result = state.catalog[index];
      audit(state, "menu.updated", "Menu updated", state.catalog[index].name);
    } else if (path[0] === "menu" && method === "POST") {
      const item = CatalogItemSchema.parse({
        ...body,
        id: uid("item"),
        modifiers: body.modifiers ?? [],
        available: body.available ?? true,
      });
      state.catalog.push(item);
      result = item;
      status = 201;
    } else if (path[0] === "memories" && path[1] && method === "DELETE") {
      const index = state.memories.findIndex((m) => m.id === path[1]);
      if (index < 0) throw new HttpError(404, "Memory not found.");
      state.memories.splice(index, 1);
      audit(
        state,
        "memory.deleted",
        "Memory deleted",
        "The mapping is no longer available to the agent.",
      );
      result = { deleted: true };
    } else if (path[0] === "memories" && path[1] && method === "PATCH") {
      const index = state.memories.findIndex((m) => m.id === path[1]);
      if (index < 0) throw new HttpError(404, "Memory not found.");
      let memory = state.memories[index];
      if (body.action === "approve") memory = approveMemory(memory);
      else if (body.action === "disable") memory = disableMemory(memory);
      else if (body.action === "enable")
        memory = {
          ...memory,
          active: true,
          reliability: memory.merchant_approved
            ? "MERCHANT_APPROVED"
            : "OBSERVED",
        };
      else if (body.action === "edit")
        memory = editMemory(
          memory,
          valuesSchema.parse(
            body.corrected_interpretation ?? memory.corrected_interpretation,
          ),
          body.observed_text ?? memory.observed_text,
        );
      else throw new HttpError(422, "Choose approve, disable, enable or edit.");
      state.memories[index] = memory;
      result = memory;
      audit(
        state,
        "memory.updated",
        "Language memory updated",
        memory.observed_text,
      );
    } else if (path[0] === "settings" && method === "PATCH") {
      const sections = [
        "business",
        "agent",
        "model",
        "pos",
        "payments",
        "notifications",
        "phone",
        "onboarding",
      ];
      const updates: Record<string, JsonObject> = body.section
        ? { [String(body.section)]: valuesSchema.parse(body.values) }
        : body;
      for (const [section, input] of Object.entries(updates)) {
        if (!sections.includes(section))
          throw new HttpError(422, "Unknown settings section.");
        const values = SettingsSchemas[section].parse(input) as JsonObject;
        if (JSON.stringify(values).length > 20000)
          throw new HttpError(422, "Settings are too large.");
        for (const key of Object.keys(values))
          if (/api.?key|secret|token/i.test(key) && values[key] === "")
            delete values[key];
        state.settings[section] = { ...state.settings[section], ...values };
      }
      const business = state.settings.business;
      if (
        Number(business.minimum_order ?? 0) >
        Number(business.maximum_order ?? 5000)
      )
        throw new HttpError(
          422,
          "Minimum order must not exceed maximum order.",
        );
      state.merchant.name = String(business.name ?? state.merchant.name).slice(
        0,
        120,
      );
      state.merchant.address = String(
        business.address ?? state.merchant.address,
      );
      state.merchant.timezone = String(
        business.timezone ?? state.merchant.timezone,
      );
      state.merchant.currency = String(business.currency ?? "MXN");
      state.merchant.language = String(
        business.language ?? state.merchant.language,
      );
      state.merchant.ordering_phone = String(
        state.settings.phone.ordering_phone ?? "",
      );
      state.merchant.notification_phone = String(
        state.settings.phone.notification_phone ??
          state.settings.notifications.manager_phone ??
          "",
      );
      result = publicSettings(state.settings);
      audit(
        state,
        "settings.updated",
        "Workspace settings saved",
        "Your merchant configuration has been updated.",
      );
    } else if (
      path[0] === "models" &&
      path[1] === "test" &&
      method === "POST"
    ) {
      const config = { ...state.settings.model, ...body };
      const key = String(config.api_key ?? env.DEEPSEEK_API_KEY ?? "");
      if (
        !key &&
        !["self-hosted", "self_hosted"].includes(String(config.hosting))
      )
        throw new HttpError(
          503,
          "Add a model API key before running compatibility tests.",
        );
      const adapter = new OpenAICompatibleAdapter({
        provider: z
          .enum(["deepseek", "qwen", "ollama", "vllm", "sglang", "generic"])
          .parse(config.provider ?? "deepseek"),
        endpoint: String(config.endpoint ?? "https://api.deepseek.com/v1"),
        model: String(config.model ?? "deepseek-flash"),
        apiKey: key,
        timeoutMs: Number(config.timeout_ms ?? 10000),
      });
      result = await runCompatibilityTest(adapter);
      state.settings.model.last_test = result;
      state.settings.model.tested_at = new Date().toISOString();
      audit(
        state,
        "model.test",
        "Model compatibility tested",
        String(config.model),
      );
    } else if (
      path[0] === "integrations" &&
      path[1] === "elevenlabs" &&
      path[2] === "configure-tools" &&
      method === "POST"
    ) {
      const configured = await configureElevenLabsTools(env, merchantId);
      result = configured;
      audit(
        state,
        "voice.tools_configured",
        "ElevenLabs tools attached and verified",
        `${configured.tools_attached} tools`,
      );
    } else if (
      path[0] === "integrations" &&
      path[2] === "test" &&
      method === "POST"
    ) {
      const integration = integrations(env, state).find(
        (i) => i.id === path[1],
      );
      if (!integration) throw new HttpError(404, "Integration not found.");
      if (!integration.configured)
        throw new HttpError(
          503,
          `Configure ${integration.name} credentials on the server first.`,
        );
      if (path[1] === "elevenlabs") {
        const response = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.ELEVENLABS_AGENT_ID!)}`,
          {
            headers: { "xi-api-key": env.ELEVENLABS_API_KEY! },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw new HttpError(
            502,
            "ElevenLabs connection failed. Check the agent ID and permissions.",
          );
        result = { status: "connected", provider: "elevenlabs" };
      } else if (path[1] === "square") {
        const { SquareAdapter } = await import(
          "../../../packages/ring-orden-connect/src/index.ts"
        );
        const config = state.settings.pos;
        const adapter = new SquareAdapter({
          accessToken: env.SQUARE_ACCESS_TOKEN!,
          locationId: String(config.location_id ?? env.SQUARE_LOCATION_ID),
          mappings: (config.catalog_mappings ?? {}) as Record<string, string>,
          sandbox: env.SQUARE_ENVIRONMENT !== "production",
        });
        const tested = await adapter.testConnection();
        result = {
          ...tested,
          status: tested.connected ? "connected" : "failed",
          message: tested.connected
            ? "Square location connection verified. Run a sandbox order to test delivery."
            : tested.error,
        };
      } else if (path[1] === "webhook") {
        const { CustomWebhookAdapter } = await import(
          "../../../packages/ring-orden-connect/src/index.ts"
        );
        const config = state.settings.pos;
        const adapter = new CustomWebhookAdapter({
          url: String(config.endpoint),
          secret: String(config.secret ?? ""),
          headers: config.token
            ? { Authorization: `Bearer ${String(config.token)}` }
            : {},
        });
        const tested = await adapter.testConnection();
        result = {
          ...tested,
          status: tested.connected ? "connected" : "failed",
          message: tested.connected
            ? "Webhook receiver accepted the connection check."
            : tested.error,
        };
      } else if (path[1] === "twilio") {
        const started = performance.now();
        const authorization = twilioAuthorization(env);
        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json?PageSize=1`,
          {
            headers: { Authorization: authorization! },
            redirect: "error",
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw new HttpError(
            502,
            "Twilio messaging credentials could not be verified.",
          );
        result = {
          provider: "twilio",
          connected: true,
          status: "connected",
          latency_ms: Math.round(performance.now() - started),
          message:
            "Messaging credentials checked. WhatsApp sender approval and recipient opt-in are verified separately.",
        };
      } else if (path[1] === "firecrawl") {
        let response: Response;
        try {
          response = await fetch(
            "https://api.firecrawl.dev/v2/team/credit-usage",
            {
              headers: { Authorization: `Bearer ${env.FIRECRAWL_API_KEY}` },
              redirect: "error",
              signal: AbortSignal.timeout(8000),
            },
          );
        } catch {
          throw new HttpError(
            504,
            "Firecrawl did not respond. Try the connection check again.",
          );
        }
        if (response.status === 401 || response.status === 403)
          throw new HttpError(
            503,
            "Firecrawl rejected this site's key. Update the Firecrawl credential in hosting settings.",
          );
        if (!response.ok)
          throw new HttpError(
            502,
            "Firecrawl could not verify the connection. Please try again.",
          );
        const credits = (await response.json().catch(() => null)) as {
          success?: boolean;
          data?: { remainingCredits?: unknown };
        } | null;
        if (!credits || credits.success === false)
          throw new HttpError(
            502,
            "Firecrawl could not verify the connection. Please try again.",
          );
        const remaining =
          typeof credits.data?.remainingCredits === "number" &&
          Number.isFinite(credits.data.remainingCredits) &&
          credits.data.remainingCredits >= 0
            ? credits.data.remainingCredits
            : null;
        result = {
          provider: "firecrawl",
          connected: true,
          status: "connected",
          remaining_credits: remaining,
          message:
            remaining === 0
              ? "Firecrawl is connected, but has no credits left. Add credits to read menu photos."
              : "Firecrawl is connected. Menu photo reading is ready to try.",
        };
      } else if (path[1] === "deepseek") {
        result = {
          status: "ready_to_test",
          test_endpoint: "/api/models/test",
          message:
            "Run the AI Model compatibility test to verify this model on actual transaction cases.",
        };
      } else if (path[1] === "supabase") {
        result = {
          provider: "supabase",
          connected: true,
          status: "connected",
          message:
            "The active scoped repository loaded your authenticated merchant state successfully.",
        };
      } else if (path[1] === "stripe") {
        const response = await fetch("https://api.stripe.com/v1/account", {
          headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
          signal: AbortSignal.timeout(8000),
        });
        if (!response.ok)
          throw new HttpError(502, "Stripe key could not be verified.");
        result = {
          status: "connected",
          test_mode: env.STRIPE_SECRET_KEY?.includes("_test_"),
        };
      } else
        result = {
          status: "configured",
          message:
            "Credentials are configured. Run a test order to verify the complete delivery path.",
        };
    } else if (
      path[0] === "voice" &&
      path[1] === "signed-url" &&
      method === "POST"
    ) {
      if (env.AGENT_MERCHANT_ID !== merchantId)
        throw new HttpError(
          403,
          "This voice agent is not bound to your merchant workspace. Configure a merchant-specific agent first.",
        );
      if (!env.ELEVENLABS_AGENT_ID)
        throw new HttpError(
          503,
          "Connect ElevenLabs to start a real voice call.",
        );
      if (env.ELEVENLABS_AGENT_PUBLIC === "true") {
        result = { agent_id: env.ELEVENLABS_AGENT_ID };
      } else {
        if (!env.ELEVENLABS_API_KEY)
          throw new HttpError(
            503,
            "Connect ElevenLabs to start a real voice call.",
          );
        const response = await fetch(
          `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(env.ELEVENLABS_AGENT_ID)}`,
          {
            headers: { "xi-api-key": env.ELEVENLABS_API_KEY },
            signal: AbortSignal.timeout(8000),
          },
        );
        if (!response.ok)
          throw new HttpError(
            502,
            `ElevenLabs rejected the voice session request (HTTP ${response.status}). Check the agent ID and API-key permissions.`,
          );
        result = await response.json();
      }
    } else if (
      path[0] === "escalations" &&
      path[2] === "resolve" &&
      method === "POST"
    ) {
      const escalation = state.escalations.find((e) => e.id === path[1]);
      if (!escalation) throw new HttpError(404, "Escalation not found.");
      escalation.status = "RESOLVED";
      result = escalation;
      audit(
        state,
        "escalation.resolved",
        "Escalation resolved",
        escalation.reason,
        escalation.order_id,
        "success",
      );
    } else if (path[0] === "team" && method === "POST") {
      const member = z
        .object({
          name: z.string().min(1).max(120),
          email: z
            .string()
            .email()
            .transform((v) => v.toLowerCase()),
          role: z.enum(["MANAGER", "STAFF"]),
        })
        .parse(body);
      const token = newInvitationToken();
      const createdAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + 24 * 3600 * 1000).toISOString();
      const invitation = {
        ...member,
        id: uid("invite"),
        status: "Pending invitation",
      };
      await repo.createInvitation(
        {
          ...member,
          id: invitation.id,
          merchant_id: merchantId,
          token_hash: await sha256Hex(token),
          expires_at: expiresAt,
          created_at: createdAt,
        },
        identity.id,
      );
      state.team.push(invitation);
      result = {
        ...invitation,
        invite_url: `${url.origin}/?invite=${token}`,
        expires_at: expiresAt,
      };
      audit(state, "team.invited", "Invitation created", member.email);
    } else if (path[0] === "tools" && method === "POST") {
      const tool = path[1];
      if (["claim_automation_jobs", "ack_automation_job"].includes(tool)) {
        if (tool === "claim_automation_jobs")
          await queueCompletedReceipts(state, env);
        result = await handleAutomationTool(state, tool, body, env);
        const saved = await repo.saveTrusted(
          merchantId,
          stored.revision,
          state,
        );
        if (!saved)
          throw new HttpError(
            409,
            "Another update just arrived. Please try again.",
          );
        return json(result);
      }
      if (tool === "get_memory_context")
        return json({
          memories: retrieveMemories(state.memories, {
            merchant_id: merchantId,
            query: String(body.query ?? ""),
            catalog: state.catalog,
            catalog_item_ids: state.catalog.map((i) => i.id),
          }),
        });
      if (tool === "model_health") {
        const config = state.settings.model;
        const key = String(config.api_key ?? env.DEEPSEEK_API_KEY ?? "");
        if (!key) throw new HttpError(503, "Configure a model API key first.");
        const adapter = new OpenAICompatibleAdapter({
          provider: z
            .enum(["deepseek", "qwen", "ollama", "vllm", "sglang", "generic"])
            .parse(config.provider ?? "deepseek"),
          endpoint: String(config.endpoint ?? "https://api.deepseek.com"),
          model: String(config.model ?? "deepseek-flash"),
          apiKey: key,
        });
        return json(await adapter.testConnection());
      }
      if (tool === "retry_failed_pos")
        return json(
          await retryDuePOS(repo, merchantId, (state, order) =>
            syncOrder(state, order, env),
          ),
        );
      if (tool === "get_menu") return json({ catalog: state.catalog });
      if (tool === "get_business_info") {
        const business = state.settings.business;
        const agent = state.settings.agent;
        return json({
          id: state.merchant.id,
          name: state.merchant.name,
          business_type: state.merchant.business_type,
          address: state.merchant.address,
          timezone: state.merchant.timezone,
          currency: state.merchant.currency,
          language: state.merchant.language,
          ordering_phone: state.merchant.ordering_phone,
          hours: business.hours ?? null,
          schedule: business.schedule ?? null,
          special_closures: business.special_closures ?? [],
          order_rules: {
            ...rules(state),
            pickup_minutes: Number(agent.pickup_minutes ?? 15),
            after_hours: String(agent.after_hours ?? "information_only"),
            ordering_enabled: agent.enabled !== false,
          },
        });
      }
      if (tool === "get_pickup_options")
        return json({
          type: "pickup",
          estimated_minutes: Number(state.settings.agent.pickup_minutes ?? 15),
        });
      const session = state.sessions.find((s) => s.id === body.session_id);
      if (!session)
        throw new HttpError(404, "Use a server-created session ID.");
      let customerResult = await handleCustomerTool(
        state,
        tool,
        body,
        session,
        env,
      );
      if (
        tool === "verify_customer" &&
        body.consent === true &&
        (customerResult as Record<string, unknown>)?.verified !== true
      ) {
        customerResult = {
          verification_required: true,
          notification: await queueCustomerVerification(
            state,
            session,
            true,
            env,
          ),
          verified: false,
        };
      }
      const automationResult =
        customerResult === undefined
          ? tool === "set_customer_followup_consent"
            ? saveFollowupConsent(state, session, {
                purpose: body.purpose,
                consent: body.consent,
                utterance: body.utterance,
              })
            : await handleAutomationTool(state, tool, body, env, session)
          : undefined;
      if (customerResult !== undefined || automationResult !== undefined) {
        result = customerResult ?? automationResult;
        const saved = await repo.saveTrusted(
          merchantId,
          stored.revision,
          state,
        );
        if (!saved)
          throw new HttpError(
            409,
            "Another update just arrived. Please try again.",
          );
        return json(result);
      }
      if (tool === "get_order_state")
        return json(findOrder(state, session.order_id));
      if (tool === "customer_link") {
        result = await issueCustomerOrderLink(
          state,
          findOrder(state, session.order_id),
          env,
        );
        status = 201;
      } else if (tool === "apply_order_operations") {
        let operations: unknown;
        try {
          operations = JSON.parse(
            z.string().min(2).max(20000).parse(body.operations_json),
          );
        } catch {
          throw new HttpError(422, "Supply a valid operations_json array.");
        }
        const parsed = z
          .array(OperationSchema)
          .min(1)
          .max(20)
          .parse(operations);
        if (parsed.some((op) => op.action === "confirm_order"))
          throw new HttpError(
            422,
            "Use confirm_order after reading back the complete order and obtaining explicit confirmation.",
          );
        result = await processTurn(
          state,
          session,
          z.string().min(1).max(1500).parse(body.utterance),
          env,
          url.origin,
          parsed,
        );
      } else if (tool === "process_order_turn")
        result = await processTurn(
          state,
          session,
          z.string().min(1).max(1500).parse(body.utterance),
          env,
        );
      else if (tool === "confirm_order") {
        if (body.confirmed !== true)
          throw new HttpError(422, "Explicit customer confirmation required.");
        const utterance = z.string().min(1).max(1500).parse(body.utterance);
        if (!isExplicitConfirmation(utterance)) {
          // Missing spoken consent is a conversational follow-up, not a failed submission.
          // Keep the exact utterance and draft; never infer consent from the tool boolean.
          const question =
            "May I place this exact order now? Please say yes to confirm, or no to keep it unsubmitted.";
          const createdAt = new Date().toISOString();
          const operations: Operation[] = [
            { action: "request_clarification", question },
          ];
          session.turns.push(
            {
              id: uid("turn"),
              role: "user",
              text: utterance,
              created_at: createdAt,
            },
            {
              id: uid("turn"),
              role: "assistant",
              text: question,
              created_at: createdAt,
              operations,
            },
          );
          result = {
            order: metadata(state, findOrder(state, session.order_id)),
            reply: question,
            confirmation_required: true,
            operations,
            turns: session.turns,
            memories_used: [],
          };
        } else {
          recordReceiptConsent(
            state,
            findOrder(state, session.order_id),
            z.boolean().optional().parse(body.whatsapp_receipt),
          );
          result = await processTurn(
            state,
            session,
            utterance,
            env,
            url.origin,
            [{ action: "confirm_order", confirmed: true }],
          );
        }
      } else if (["request_human", "escalate_issue"].includes(tool)) {
        let order = findOrder(state, session.order_id);
        order = applyOperation(
          order,
          {
            action: "escalate_issue",
            reason: String(body.reason ?? "Customer requested a person"),
          },
          state.catalog,
        );
        replaceOrder(state, order);
        const ticket = {
          id: uid("esc"),
          order_id: order.id,
          customer: order.customer.name ?? "Caller",
          reason: String(body.reason ?? "Customer requested a person"),
          status: "OPEN" as const,
          created_at: new Date().toISOString(),
          priority: "High",
        };
        state.escalations.unshift(ticket);
        result = {
          escalation: ticket,
          transfer_available: false,
          reply: "I’ve asked the team to call you back.",
        };
      } else throw new HttpError(404, "Unknown agent tool.");
    } else throw new HttpError(404, "Endpoint not found.");
    if (requestKey) {
      state.requests[requestKey] = { body_hash: digest, result };
      const keys = Object.keys(state.requests);
      for (const key of keys.slice(0, Math.max(0, keys.length - 250)))
        delete state.requests[key];
    }
    const saved = trustedTool
      ? await repo.saveTrusted(merchantId, stored.revision, state)
      : await repo.save(merchantId, identity.id, stored.revision, state);
    if (!saved)
      throw new HttpError(
        409,
        "Another update just arrived. Please try again.",
      );
    for (const [orderId, meta] of Object.entries(state.order_metadata))
      if (meta.delivery_status === "PENDING") {
        const delivered = await deliverPendingOrder(
          repo,
          merchantId,
          orderId,
          env,
        );
        if (
          delivered &&
          result &&
          typeof result === "object" &&
          "order" in result
        )
          (result as { order: unknown }).order = metadata(
            (await repo.loadByMerchant(merchantId))?.state ?? state,
            delivered,
          );
      }
    if (
      role !== "OWNER" &&
      result &&
      typeof result === "object" &&
      "order" in result
    )
      (result as { order: Record<string, unknown> }).order = redactOrderForRole(
        (result as { order: Record<string, unknown> }).order,
        role,
      );
    return json(result, status);
  } catch (error) {
    if (error instanceof HttpError)
      return json({ error: error.message }, error.status);
    if (error instanceof z.ZodError)
      return json(
        {
          error: error.issues
            .map(
              (issue) => `${issue.path.join(".") || "Input"}: ${issue.message}`,
            )
            .join("; "),
        },
        422,
      );
    return json(
      {
        error:
          error instanceof Error
            ? error.message
            : "An unexpected error occurred. Your saved orders are safe.",
      },
      400,
    );
  }
}
