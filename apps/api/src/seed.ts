import {
  createOrder,
  applyOperation,
  transitionOrder,
  DEMO_CATALOG,
} from "../../../packages/ring-orden-core/src/index.ts";
import {
  extractCorrection,
  approveMemory,
  mergeObservation,
  recordMemoryUse,
} from "../../../packages/ring-orden-memory/src/index.ts";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
import type { TenantState } from "./types.ts";
import type { Identity } from "./auth.ts";
export function seedTenant(
  merchantId: string,
  user: Identity,
  demo = true,
): TenantState {
  const now = new Date().toISOString();
  const state: TenantState = {
    merchant: {
      id: merchantId,
      name: "Café Oliva",
      business_type: "Café & bakery",
      address: "Colima 145, Roma Norte, Ciudad de México",
      timezone: "America/Mexico_City",
      currency: "MXN",
      language: "es-MX",
      ordering_phone: "",
      notification_phone: "",
      created_at: now,
    },
    catalog: structuredClone(DEMO_CATALOG),
    orders: [],
    memories: [],
    sessions: [],
    escalations: [],
    events: [],
    order_metadata: {},
    requests: {},
    settings: {
      business: {
        name: "Café Oliva",
        timezone: "America/Mexico_City",
        currency: "MXN",
        language: "es-MX",
        address: "Colima 145, Roma Norte, Ciudad de México",
        hours: "Mon–Fri 07:00–20:00 · Sat–Sun 08:00–18:00",
        schedule: Object.fromEntries(
          ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
            day,
            {
              enabled: true,
              open: ["sat", "sun"].includes(day) ? "08:00" : "07:00",
              close: ["sat", "sun"].includes(day) ? "18:00" : "20:00",
            },
          ]),
        ),
        tax_rate: 0,
        minimum_order: 0,
        maximum_order: 5000,
        maximum_quantity: 50,
      },
      agent: {
        languages: ["es-MX", "en-US", "zh-CN"],
        voice: "Warm & conversational",
        greeting:
          "¡Hola! Gracias por llamar a Café Oliva. ¿Qué te gustaría pedir?",
        pickup_minutes: 15,
        handoff_number: "",
        instructions:
          "Ask one concise question at a time. Repeat the final order and require explicit confirmation.",
        after_hours: "information_only",
        enabled: true,
      },
      model: {
        provider: "deepseek",
        model: "deepseek-flash",
        endpoint: "https://api.deepseek.com/v1",
        hosting: "hosted",
        fallback_enabled: false,
        timeout_ms: 10000,
        status: "setup_required",
      },
      pos: { provider: "dashboard", status: "dashboard_only", retry_limit: 3 },
      payments: {
        provider: "stripe",
        test_mode: true,
        status: "setup_required",
      },
      notifications: {
        whatsapp: true,
        sms: false,
        email: false,
        manager_phone: "",
        status: "setup_required",
      },
      phone: {
        mode: "forwarding",
        ordering_phone: "",
        notification_phone: "",
        status: "setup_required",
      },
      onboarding: { step: 1, completed: false },
    },
    team: [
      {
        id: user.id,
        name: user.name,
        email: user.email,
        role: "OWNER",
        status: "Active",
      },
    ],
  };
  if (!demo) return state;
  const names = [
    "Lucía Torres",
    "James Wilson",
    "Mariana López",
    "David Chen",
    "Sofía Reyes",
    "Carlos Rivera",
    "Emma Watson",
    "Andrés García",
    "Camila Vega",
    "Daniel Kim",
    "Valentina Ruiz",
    "Mateo Flores",
    "Julia Santos",
    "Diego Mendoza",
  ];
  const menu = [
    "iced_latte",
    "latte",
    "cappuccino",
    "americano",
    "chocolate_croissant",
    "ube_croissant",
    "croissant",
  ];
  const phases = [
    "PAYMENT_PENDING",
    "PAID",
    "PREPARING",
    "READY",
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "COMPLETED",
    "CANCELLED",
    "COMPLETED",
    "POS_SYNC_FAILED",
    "DRAFT",
  ] as const;
  names.forEach((name, index) => {
    let order = createOrder(merchantId, `order_${1048 - index}`);
    order.source = "demo";
    order.customer = {
      name,
      phone: `+52555550${String(index).padStart(4, "0")}`,
    };
    order.external_reference = `RO-${1048 - index}`;
    order = applyOperation(
      order,
      {
        action: "add_item",
        catalog_item_id: menu[index % menu.length],
        quantity: index % 3 === 0 ? 2 : 1,
      },
      state.catalog,
    );
    if (index % menu.length < 2)
      order = applyOperation(
        order,
        {
          action: "add_modifier",
          target: { line_id: order.items[0].line_id },
          modifier_id: "oat_milk",
        },
        state.catalog,
      );
    if (index % 3 === 0)
      order = applyOperation(
        order,
        { action: "add_item", catalog_item_id: "chocolate_croissant" },
        state.catalog,
      );
    if (phases[index] !== "DRAFT")
      order = applyOperation(
        order,
        { action: "confirm_order", confirmed: true },
        state.catalog,
      );
    const phase = phases[index];
    if (phase === "CANCELLED") order = transitionOrder(order, "CANCELLED");
    else if (phase === "PAYMENT_PENDING")
      order = transitionOrder(order, "PAYMENT_PENDING");
    else if (phase === "POS_SYNC_FAILED")
      order = transitionOrder(order, "POS_SYNC_FAILED");
    else if (phase !== "DRAFT") {
      order = transitionOrder(order, "PAID");
      if (["PREPARING", "READY", "COMPLETED"].includes(phase))
        order = transitionOrder(order, "PREPARING");
      if (["READY", "COMPLETED"].includes(phase))
        order = transitionOrder(order, "READY");
      if (phase === "COMPLETED") order = transitionOrder(order, "COMPLETED");
    }
    const date = new Date(Date.now() - (index * 19 + 2) * 60000).toISOString();
    order.created_at = date;
    order.updated_at = date;
    state.orders.push(order);
    state.order_metadata[order.id] = {
      pos_status: phase === "POS_SYNC_FAILED" ? "FAILED" : "DASHBOARD_ONLY",
      notification_status: index === 0 ? "DEMO_PREVIEW" : "DEMO_DELIVERED",
      demo: true,
    };
    const sessionId = `session_demo_${1048 - index}`;
    state.sessions.push({
      id: sessionId,
      order_id: order.id,
      created_at: date,
      status: phase === "DRAFT" ? "ACTIVE" : "COMPLETED",
      pending_corrections: [],
      turns: [
        {
          id: crypto.randomUUID(),
          role: "user",
          text:
            index % 2 === 0
              ? "Me regalas dos iced lattes, uno con avena."
              : "Can I get a " +
                order.items[0].name.toLowerCase() +
                ", please?",
          created_at: date,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: `Of course. Your order comes to $${order.total.toFixed(2)} MXN. Ready in about 15 minutes. Shall I confirm it?`,
          created_at: date,
          latency_ms: 640 + index * 23,
          model: "Demo interpreter",
        },
        {
          id: crypto.randomUUID(),
          role: "user",
          text: "Yes, that’s correct. Thank you!",
          created_at: date,
        },
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: "Confirmed! Your pickup order is saved. See you soon.",
          created_at: date,
        },
      ],
    });
  });
  const phrases = [
    ["late con abena", "latte", "oat_milk"],
    ["purple croissant", "ube_croissant", ""],
    ["café de la casa", "americano", ""],
    ["uno sin cafeína", "latte", "decaf"],
    ["milk de almendras", "latte", "almond_milk"],
    ["un chocolatín", "chocolate_croissant", ""],
  ];
  for (let i = 0; i < phrases.length; i++) {
    const [phrase, product, modifier] = phrases[i];
    let memory = extractCorrection({
      merchant_id: merchantId,
      observed_text: phrase,
      language: i === 1 ? "en-US" : "es-MX",
      previous_interpretation: { product: "unknown" },
      corrected_interpretation: { product, ...(modifier ? { modifier } : {}) },
      confirmed_by_customer: true,
    });
    if (memory) {
      for (let n = 0; n < i + 3; n++) memory = mergeObservation(memory);
      for (let n = 0; n < i + 2; n++) memory = recordMemoryUse(memory, true);
      if (i < 3) memory = approveMemory(memory);
      state.memories.push(memory);
    }
  }
  const escalated = state.orders[12];
  state.escalations.push({
    id: "esc_demo_1",
    order_id: escalated.id,
    customer: escalated.customer.name ?? "Customer",
    reason: "Demo example: POS delivery needs a manual retry.",
    status: "OPEN",
    created_at: now,
    priority: "Medium",
  });
  state.events = [
    {
      id: crypto.randomUUID(),
      type: "order.confirmed",
      title: "New phone order",
      detail: `${state.orders[0].external_reference} · ${state.orders[0].customer.name}`,
      created_at: state.orders[0].created_at,
      order_id: state.orders[0].id,
      level: "success",
    },
    {
      id: crypto.randomUUID(),
      type: "memory.approved",
      title: "Your agent is learning",
      detail: "“late con abena” now resolves to latte with oat milk.",
      created_at: now,
      level: "info",
    },
    {
      id: crypto.randomUUID(),
      type: "demo.loaded",
      title: "Demo workspace ready",
      detail:
        "Sample orders and conversations are clearly marked as demo data.",
      created_at: now,
      level: "info",
    },
  ];
  return state;
}
