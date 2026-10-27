import type { Order } from "../../ring-orden-core/src/index.ts";
export interface POSCapabilities {
  catalog_read: boolean;
  catalog_write: boolean;
  order_create: boolean;
  order_update: boolean;
  order_cancel: boolean;
  webhooks: boolean;
  payment_sync: boolean;
  verified: boolean;
  note?: string;
}
export interface ConnectionResult {
  connected: boolean;
  provider: string;
  error?: string;
  latency_ms: number;
}
export interface POSOrderResult {
  external_order_id: string;
  provider: string;
  status: "SYNCED";
  reference: string;
}
export interface POSAdapter {
  id: string;
  testConnection(): Promise<ConnectionResult>;
  capabilities(): Promise<POSCapabilities>;
  createOrder(order: Order): Promise<POSOrderResult>;
}
const unsupported: POSCapabilities = {
  catalog_read: false,
  catalog_write: false,
  order_create: false,
  order_update: false,
  order_cancel: false,
  webhooks: false,
  payment_sync: false,
  verified: false,
};
export const PROVIDER_MANIFESTS: Record<string, POSCapabilities> = {
  square: {
    ...unsupported,
    order_create: true,
    note: "Orders API create implemented. Sandbox account compatibility must be verified; creation alone does not guarantee a kitchen ticket.",
  },
  webhook: {
    ...unsupported,
    order_create: true,
    note: "HTTP canonical-order delivery; receiver must honor Idempotency-Key.",
  },
  polotab: {
    ...unsupported,
    note: "Adapter specification only. No write API has been verified.",
  },
  parrot: {
    ...unsupported,
    note: "Adapter specification only. No write API has been verified.",
  },
  zettle: {
    ...unsupported,
    note: "Adapter specification only. No write API has been verified.",
  },
  generic: {
    ...unsupported,
    note: "Use custom webhook for explicit HTTP delivery.",
  },
  none: {
    ...unsupported,
    verified: true,
    note: "Dashboard-only ordering; no POS submission.",
  },
};
function requireConfirmed(order: Order) {
  if (
    [
      "DRAFT",
      "AWAITING_CLARIFICATION",
      "AWAITING_CONFIRMATION",
      "CANCELLED",
      "REFUNDED",
    ].includes(order.status)
  )
    throw new Error("Only a confirmed order can be sent to a POS");
}
function idempotencyKey(order: Order) {
  return `ring-orden:${order.merchant_id}:${order.id}`.slice(0, 180);
}
export interface SquareConfig {
  accessToken: string;
  locationId: string;
  mappings: Record<string, string>;
  sandbox?: boolean;
  apiVersion?: string;
  fetch?: typeof fetch;
}
export class SquareAdapter implements POSAdapter {
  id = "square";
  private config: SquareConfig;
  private base: string;
  constructor(config: SquareConfig) {
    if (!config.accessToken || !config.locationId)
      throw new Error("Square access token and location ID required");
    this.config = config;
    this.base =
      config.sandbox === false
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";
  }
  private headers() {
    return {
      Authorization: `Bearer ${this.config.accessToken}`,
      "Content-Type": "application/json",
      ...(this.config.apiVersion
        ? { "Square-Version": this.config.apiVersion }
        : {}),
    };
  }
  async capabilities(): Promise<POSCapabilities> {
    return { ...PROVIDER_MANIFESTS.square };
  }
  async testConnection(): Promise<ConnectionResult> {
    const start = performance.now();
    try {
      const r = await (this.config.fetch ?? fetch)(
        `${this.base}/v2/locations/${encodeURIComponent(this.config.locationId)}`,
        { headers: this.headers(), signal: AbortSignal.timeout(8000) },
      );
      if (!r.ok) throw Error(`Square HTTP ${r.status}`);
      return {
        connected: true,
        provider: this.id,
        latency_ms: Math.round(performance.now() - start),
      };
    } catch (e) {
      return {
        connected: false,
        provider: this.id,
        latency_ms: Math.round(performance.now() - start),
        error: e instanceof Error ? e.message : "Square connection failed",
      };
    }
  }
  toPayload(order: Order) {
    requireConfirmed(order);
    if (order.tax !== 0 || order.fees !== 0)
      throw new Error(
        "Square adapter requires explicit tax/fees mapping before sending an order with tax or fees",
      );
    const line_items = order.items.map((item) => {
      const external = this.config.mappings[item.catalog_item_id];
      if (!external)
        throw new Error(
          `Missing Square catalog mapping for ${item.catalog_item_id}`,
        );
      return {
        uid: item.line_id,
        catalog_object_id: external,
        quantity: String(item.quantity),
        base_price_money: {
          amount: Math.round(item.unit_price * 100),
          currency: order.currency,
        },
        modifiers: item.modifiers.map((m) => {
          const externalModifier = this.config.mappings[m.modifier_id];
          if (!externalModifier)
            throw new Error(
              `Missing Square modifier mapping for ${m.modifier_id}`,
            );
          return {
            catalog_object_id: externalModifier,
            base_price_money: {
              amount: Math.round(m.price_delta * 100),
              currency: order.currency,
            },
          };
        }),
      };
    });
    return {
      idempotency_key: idempotencyKey(order),
      order: {
        location_id: this.config.locationId,
        reference_id: order.external_reference,
        source: { name: "Ring Orden" },
        line_items,
        ...(order.notes.length
          ? {
              metadata: {
                ring_orden_notes: order.notes.join("; ").slice(0, 255),
              },
            }
          : {}),
        ...(order.fulfillment.type === "pickup"
          ? {
              fulfillments: [
                {
                  type: "PICKUP",
                  state: "PROPOSED",
                  pickup_details: {
                    recipient: {
                      display_name:
                        order.customer.name || "Ring Orden customer",
                      ...(order.customer.phone
                        ? { phone_number: order.customer.phone }
                        : {}),
                    },
                    schedule_type: order.fulfillment.scheduled_for
                      ? "SCHEDULED"
                      : "ASAP",
                    ...(order.fulfillment.scheduled_for
                      ? { pickup_at: order.fulfillment.scheduled_for }
                      : {}),
                  },
                },
              ],
            }
          : {}),
      },
    };
  }
  async createOrder(order: Order): Promise<POSOrderResult> {
    const response = await (this.config.fetch ?? fetch)(
      `${this.base}/v2/orders`,
      {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.toPayload(order)),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new Error(
        `Square order submission failed: HTTP ${response.status}`,
      );
    const data = (await response.json()) as {
      order?: { id?: string };
      errors?: unknown[];
    };
    if (!data.order?.id || data.errors?.length)
      throw new Error("Square did not acknowledge a created order");
    return {
      external_order_id: data.order.id,
      provider: this.id,
      status: "SYNCED",
      reference: order.external_reference,
    };
  }
}
export interface WebhookConfig {
  url: string;
  secret?: string;
  headers?: Record<string, string>;
  fetch?: typeof fetch;
}
export class CustomWebhookAdapter implements POSAdapter {
  id = "webhook";
  private config: WebhookConfig;
  constructor(config: WebhookConfig) {
    const u = new URL(config.url);
    if (u.protocol !== "https:" || u.username || u.password)
      throw new Error(
        "Webhook requires an HTTPS URL without embedded credentials",
      );
    const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
    const ip = host.split(".").map(Number);
    const privateV4 =
      ip.length === 4 &&
      ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
      (ip[0] === 0 ||
        ip[0] === 10 ||
        ip[0] === 127 ||
        ip[0] >= 224 ||
        (ip[0] === 169 && ip[1] === 254) ||
        (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
        (ip[0] === 192 && ip[1] === 168) ||
        (ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127));
    if (
      privateV4 ||
      !host.includes(".") ||
      host === "localhost" ||
      (host.includes(":") &&
        (/^(::|fc|fd|fe[89ab])/i.test(host) || host.startsWith("::ffff:"))) ||
      /\.(?:localhost|local|internal|lan|home|test)$/.test(host)
    )
      throw new Error("Private/local webhook destinations are disabled");
    this.config = config;
  }
  async capabilities(): Promise<POSCapabilities> {
    return { ...PROVIDER_MANIFESTS.webhook };
  }
  async testConnection(): Promise<ConnectionResult> {
    const start = performance.now();
    try {
      const r = await (this.config.fetch ?? fetch)(this.config.url, {
        method: "HEAD",
        redirect: "error",
        headers: this.config.headers,
        signal: AbortSignal.timeout(8000),
      });
      return {
        connected: r.ok,
        provider: this.id,
        latency_ms: Math.round(performance.now() - start),
        ...(!r.ok
          ? {
              error: `Webhook HEAD returned HTTP ${r.status}; configure a receiver that accepts HEAD.`,
            }
          : {}),
      };
    } catch (e) {
      return {
        connected: false,
        provider: this.id,
        latency_ms: Math.round(performance.now() - start),
        error: e instanceof Error ? e.message : "Webhook connection failed",
      };
    }
  }
  async createOrder(order: Order): Promise<POSOrderResult> {
    requireConfirmed(order);
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      event: "order.confirmed",
      idempotency_key: idempotencyKey(order),
      order,
    });
    let signature = "";
    if (this.config.secret) {
      const key = await crypto.subtle.importKey(
        "raw",
        new TextEncoder().encode(this.config.secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const bytes = await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${timestamp}.${body}`),
      );
      signature = Array.from(new Uint8Array(bytes))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
    const response = await (this.config.fetch ?? fetch)(this.config.url, {
      method: "POST",
      redirect: "error",
      headers: {
        ...this.config.headers,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey(order),
        "X-Ring-Orden-Timestamp": timestamp,
        ...(signature ? { "X-Ring-Orden-Signature": `v1=${signature}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new Error(`Webhook delivery failed: HTTP ${response.status}`);
    let data: { id?: string; external_order_id?: string } = {};
    try {
      data = await response.json();
    } catch {
      /* Receivers may respond 204; acknowledgement is sufficient. */
    }
    return {
      external_order_id: data.external_order_id ?? data.id ?? order.id,
      provider: this.id,
      status: "SYNCED",
      reference: order.external_reference,
    };
  }
}
export class UnsupportedPOSAdapter implements POSAdapter {
  id: string;
  constructor(provider: string) {
    this.id = provider;
  }
  async capabilities() {
    return {
      ...unsupported,
      note: "Not implemented. Use dashboard-only or a custom webhook.",
    };
  }
  async testConnection(): Promise<ConnectionResult> {
    return {
      connected: false,
      provider: this.id,
      latency_ms: 0,
      error: "Provider adapter has not been implemented or verified",
    };
  }
  async createOrder(_order: Order): Promise<POSOrderResult> {
    throw new Error(`Order creation not supported by ${this.id}`);
  }
}
