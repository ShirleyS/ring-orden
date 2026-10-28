import type {
  Order,
  CatalogItem,
  Operation,
} from "../../../packages/ring-orden-core/src/index.ts";
import type { CorrectionMemory } from "../../../packages/ring-orden-memory/src/index.ts";
export type JsonObject = Record<string, unknown>;
export interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  created_at: string;
  operations?: Operation[];
  latency_ms?: number;
  model?: string;
  memories_used?: string[];
}
export interface Session {
  id: string;
  order_id: string;
  turns: Turn[];
  created_at: string;
  status: string;
  pending_corrections: {
    observed_text: string;
    previous_interpretation: JsonObject;
    corrected_interpretation: JsonObject;
  }[];
}
export interface AuditEvent {
  id: string;
  type: string;
  title: string;
  detail: string;
  created_at: string;
  order_id?: string;
  level: "info" | "success" | "warning" | "error";
  data?: unknown;
}
export interface OrderMetadata {
  customer_link?: { hash: string; expires_at: string };
  pos_status: string;
  notification_status: string;
  checkout_id?: string;
  checkout_url?: string;
  demo: boolean;
  delivery_status?: "PENDING" | "PROCESSING" | "DONE" | "FAILED";
  pos_attempts?: number;
  pos_next_retry_at?: string | null;
  pos_retry_claim?: string | null;
  pos_retry_claimed_at?: string | null;
}
export interface Escalation {
  id: string;
  order_id: string;
  customer: string;
  reason: string;
  status: "OPEN" | "RESOLVED";
  created_at: string;
  priority: string;
}
export interface TenantState {
  merchant: {
    id: string;
    name: string;
    business_type: string;
    address: string;
    timezone: string;
    currency: string;
    language: string;
    ordering_phone: string;
    notification_phone: string;
    created_at: string;
  };
  catalog: CatalogItem[];
  orders: Order[];
  memories: CorrectionMemory[];
  sessions: Session[];
  escalations: Escalation[];
  events: AuditEvent[];
  order_metadata: Record<string, OrderMetadata>;
  settings: Record<string, JsonObject>;
  team: {
    id: string;
    name: string;
    email: string;
    role: "OWNER" | "MANAGER" | "STAFF";
    status: string;
  }[];
  requests: Record<string, { body_hash: string; result: unknown }>;
}
export interface StoredState {
  state: TenantState;
  revision: number;
}
export interface Repository {
  listMemberships(subject: string): Promise<Membership[]>;
  createInvitation(invitation: Invitation, ownerSubject: string): Promise<void>;
  getInvitation(hash: string): Promise<Invitation | null>;
  acceptInvitation(
    hash: string,
    subject: string,
    email: string,
  ): Promise<Invitation | null>;
  load(merchantId: string, ownerId: string): Promise<StoredState | null>;
  create(
    merchantId: string,
    ownerId: string,
    state: TenantState,
  ): Promise<void>;
  save(
    merchantId: string,
    ownerId: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean>;
  saveTrusted(
    merchantId: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean>;
  hasEvent(id: string): Promise<boolean>;
  recordEvent(
    id: string,
    merchantId: string,
    provider: string,
    type: string,
  ): Promise<void>;
  loadByMerchant(merchantId: string): Promise<StoredState | null>;
}

export type MerchantRole = "OWNER" | "MANAGER" | "STAFF";
export interface Membership {
  merchant_id: string;
  subject: string;
  email: string;
  name: string;
  role: MerchantRole;
}
export interface Invitation {
  id: string;
  merchant_id: string;
  token_hash: string;
  email: string;
  name: string;
  role: "MANAGER" | "STAFF";
  expires_at: string;
  created_at: string;
  accepted_by?: string | null;
  accepted_at?: string | null;
}
