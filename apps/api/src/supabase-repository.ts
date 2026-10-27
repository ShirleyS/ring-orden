import type {
  Invitation,
  Membership,
  Repository,
  StoredState,
  TenantState,
} from "./types.ts";
import { HttpError } from "./auth.ts";
export interface SupabaseRepositoryConfig {
  url: string;
  serverSecret: string;
  fetch?: typeof fetch;
}
/** PostgREST RPC boundary. No server secret or unscoped table access reaches browsers. */
export class SupabaseRepository implements Repository {
  private origin: string;
  private key: string;
  private request: typeof fetch;
  constructor(config: SupabaseRepositoryConfig) {
    const url = new URL(config.url);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error(
        "Supabase URL must use HTTPS without embedded credentials.",
      );
    this.origin = url.origin;
    this.key = config.serverSecret;
    this.request = config.fetch ?? fetch;
    if (!this.key) throw new Error("Supabase server secret is required.");
  }
  private async rpc<T>(
    operation: string,
    body: Record<string, unknown>,
  ): Promise<T> {
    const response = await this.request(
      `${this.origin}/rest/v1/rpc/${operation}`,
      {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: this.key,
          ...(this.key.startsWith("sb_secret_")
            ? {}
            : { Authorization: `Bearer ${this.key}` }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new HttpError(
        503,
        `Supabase repository ${operation} failed (HTTP ${response.status}). Check the runtime migration and server-only key.`,
      );
    return (await response.json()) as T;
  }
  async load(merchantId: string, subject: string): Promise<StoredState | null> {
    return this.rpc("ring_load_state", {
      p_merchant_id: merchantId,
      p_subject: subject,
    });
  }
  async loadByMerchant(merchantId: string): Promise<StoredState | null> {
    return this.rpc("ring_load_trusted_state", { p_merchant_id: merchantId });
  }
  async create(
    merchantId: string,
    subject: string,
    state: TenantState,
  ): Promise<void> {
    await this.rpc("ring_create_state", {
      p_merchant_id: merchantId,
      p_subject: subject,
      p_payload: state,
    });
  }
  async save(
    merchantId: string,
    subject: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean> {
    return this.rpc("ring_save_state", {
      p_merchant_id: merchantId,
      p_subject: subject,
      p_revision: revision,
      p_payload: state,
    });
  }
  async saveTrusted(
    merchantId: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean> {
    return this.rpc("ring_save_trusted_state", {
      p_merchant_id: merchantId,
      p_revision: revision,
      p_payload: state,
    });
  }
  async hasEvent(id: string): Promise<boolean> {
    return this.rpc("ring_has_event", { p_event_id: id });
  }
  async recordEvent(
    id: string,
    merchantId: string,
    provider: string,
    type: string,
  ): Promise<void> {
    await this.rpc("ring_record_event", {
      p_event_id: id,
      p_merchant_id: merchantId,
      p_provider: provider,
      p_event_type: type,
    });
  }
  async listMemberships(subject: string): Promise<Membership[]> {
    return this.rpc("ring_memberships", { p_subject: subject });
  }
  async createInvitation(
    invitation: Invitation,
    ownerSubject: string,
  ): Promise<void> {
    await this.rpc("ring_create_invitation", {
      p_invitation: invitation,
      p_owner_subject: ownerSubject,
    });
  }
  async getInvitation(hash: string): Promise<Invitation | null> {
    return this.rpc("ring_get_invitation", { p_hash: hash });
  }
  async acceptInvitation(
    hash: string,
    subject: string,
    email: string,
  ): Promise<Invitation | null> {
    return this.rpc("ring_accept_invitation", {
      p_hash: hash,
      p_subject: subject,
      p_email: email.toLowerCase(),
    });
  }
}
