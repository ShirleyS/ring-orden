import type {
  Repository,
  TenantState,
  StoredState,
  Membership,
  Invitation,
} from "./types.ts";

/** Parameterized query boundary; wrap getDatabase().sql.unsafe in an async function. */
export type NetlifyQuery = (
  text: string,
  params?: unknown[],
) => Promise<Record<string, unknown>[]>;

type StateRow = { state: TenantState | string; revision: number | string };
function stored(row: Record<string, unknown> | undefined): StoredState | null {
  if (!row) return null;
  const value = row as StateRow;
  return {
    state:
      typeof value.state === "string" ? JSON.parse(value.state) : value.state,
    revision: Number(value.revision),
  };
}
function invitationRow(
  row: Record<string, unknown> | undefined,
): Invitation | null {
  if (!row) return null;
  const normalized = { ...row };
  for (const key of ["expires_at", "created_at", "accepted_at"]) {
    const value = normalized[key];
    if (value instanceof Date) normalized[key] = value.toISOString();
  }
  return normalized as unknown as Invitation;
}
function matchesMerchant(merchantId: string, state: TenantState): boolean {
  return Boolean(merchantId && state?.merchant?.id === merchantId);
}

/**
 * Durable Netlify Database/Postgres storage. Identity and role verification happen
 * before this boundary; every merchant-facing query still enforces membership.
 * Trusted methods are reserved for already-verified webhooks and service tools.
 */
export class NetlifyRepository implements Repository {
  private query: NetlifyQuery;
  constructor(query: NetlifyQuery) {
    this.query = query;
  }

  async load(merchantId: string, subject: string): Promise<StoredState | null> {
    if (!merchantId || !subject) return null;
    const rows = await this.query(
      `SELECT a.payload AS state,a.revision FROM ring_netlify.app_state a
       WHERE a.merchant_id=$1 AND (a.owner_subject=$2 OR EXISTS(
         SELECT 1 FROM ring_netlify.memberships m
         WHERE m.merchant_id=a.merchant_id AND m.user_subject=$2))`,
      [merchantId, subject],
    );
    return stored(rows[0]);
  }

  async loadByMerchant(merchantId: string): Promise<StoredState | null> {
    if (!merchantId) return null;
    const rows = await this.query(
      "SELECT payload AS state,revision FROM ring_netlify.app_state WHERE merchant_id=$1",
      [merchantId],
    );
    return stored(rows[0]);
  }

  async create(
    merchantId: string,
    subject: string,
    state: TenantState,
  ): Promise<void> {
    if (!subject || !matchesMerchant(merchantId, state)) {
      throw new Error(
        "A verified owner and matching merchant identity are required.",
      );
    }
    const inserted = await this.query(
      `INSERT INTO ring_netlify.app_state(merchant_id,owner_subject,name,payload)
       VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(merchant_id) DO NOTHING
       RETURNING merchant_id`,
      [merchantId, subject, state.merchant.name, JSON.stringify(state)],
    );
    if (inserted.length) return;
    // Idempotent initialization must never overwrite an existing merchant or owner.
    const existing = await this.query(
      "SELECT merchant_id FROM ring_netlify.app_state WHERE merchant_id=$1 AND owner_subject=$2",
      [merchantId, subject],
    );
    if (!existing.length) throw new Error("Merchant ownership mismatch.");
  }

  async save(
    merchantId: string,
    subject: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean> {
    if (!subject || !matchesMerchant(merchantId, state)) return false;
    const rows = await this.query(
      `UPDATE ring_netlify.app_state a
       SET payload=$4::jsonb,name=$5,revision=a.revision+1,updated_at=now()
       WHERE a.merchant_id=$1 AND a.revision=$3
       AND (a.owner_subject=$2 OR EXISTS(SELECT 1 FROM ring_netlify.memberships m
         WHERE m.merchant_id=a.merchant_id AND m.user_subject=$2))
       RETURNING a.merchant_id`,
      [
        merchantId,
        subject,
        revision,
        JSON.stringify(state),
        state.merchant.name,
      ],
    );
    return rows.length === 1;
  }

  async saveTrusted(
    merchantId: string,
    revision: number,
    state: TenantState,
  ): Promise<boolean> {
    if (!matchesMerchant(merchantId, state)) return false;
    const rows = await this.query(
      `UPDATE ring_netlify.app_state
       SET payload=$3::jsonb,name=$4,revision=revision+1,updated_at=now()
       WHERE merchant_id=$1 AND revision=$2 RETURNING merchant_id`,
      [merchantId, revision, JSON.stringify(state), state.merchant.name],
    );
    return rows.length === 1;
  }

  async listMemberships(subject: string): Promise<Membership[]> {
    if (!subject) return [];
    const rows = await this.query(
      `SELECT a.merchant_id,a.owner_subject AS subject,'' AS email,a.name,'OWNER' AS role
       FROM ring_netlify.app_state a WHERE a.owner_subject=$1
       UNION ALL
       SELECT m.merchant_id,m.user_subject AS subject,m.email,m.name,m.role
       FROM ring_netlify.memberships m JOIN ring_netlify.app_state a USING(merchant_id)
       WHERE m.user_subject=$1 AND a.owner_subject<>$1`,
      [subject],
    );
    return rows as unknown as Membership[];
  }

  async createInvitation(
    invitation: Invitation,
    ownerSubject: string,
  ): Promise<void> {
    if (!ownerSubject)
      throw new Error("Only the owner can create an invitation.");
    const rows = await this.query(
      `INSERT INTO ring_netlify.invitations
        (id,merchant_id,token_hash,email,name,role,expires_at,created_at)
       SELECT $1,$2,$3,$4,$5,$6,$7::timestamptz,$8::timestamptz
       FROM ring_netlify.app_state a WHERE a.merchant_id=$2 AND a.owner_subject=$9
       RETURNING id`,
      [
        invitation.id,
        invitation.merchant_id,
        invitation.token_hash,
        invitation.email.trim().toLowerCase(),
        invitation.name,
        invitation.role,
        invitation.expires_at,
        invitation.created_at,
        ownerSubject,
      ],
    );
    if (rows.length !== 1)
      throw new Error("Only the owner can create an invitation.");
  }

  async getInvitation(hash: string): Promise<Invitation | null> {
    if (!hash) return null;
    const rows = await this.query(
      `SELECT id,merchant_id,token_hash,email,name,role,expires_at,created_at,
       accepted_by,accepted_at FROM ring_netlify.invitations WHERE token_hash=$1`,
      [hash],
    );
    return invitationRow(rows[0]);
  }

  async acceptInvitation(
    hash: string,
    subject: string,
    email: string,
  ): Promise<Invitation | null> {
    if (!hash || !subject || !email.trim()) return null;
    // One SQL statement is one Postgres transaction. Either both invitation and
    // membership change, or neither does. Concurrent consumers cannot both win.
    const rows = await this.query(
      `WITH accepted AS (
         UPDATE ring_netlify.invitations SET accepted_by=$2,accepted_at=now()
         WHERE token_hash=$1 AND accepted_by IS NULL AND expires_at>now()
           AND lower(email)=$3
         RETURNING *
       ), member AS (
         INSERT INTO ring_netlify.memberships
           (merchant_id,user_subject,email,name,role)
         SELECT merchant_id,$2,email,name,role FROM accepted
         ON CONFLICT(merchant_id,user_subject) DO UPDATE
           SET email=excluded.email,name=excluded.name,role=excluded.role
         RETURNING merchant_id
       ) SELECT a.* FROM accepted a JOIN member m USING(merchant_id)`,
      [hash, subject, email.trim().toLowerCase()],
    );
    return invitationRow(rows[0]);
  }

  async hasEvent(id: string): Promise<boolean> {
    if (!id) return false;
    const rows = await this.query(
      "SELECT event_id FROM ring_netlify.integration_events WHERE event_id=$1",
      [id],
    );
    return rows.length > 0;
  }

  async recordEvent(
    id: string,
    merchantId: string,
    provider: string,
    type: string,
  ): Promise<void> {
    await this.query(
      `INSERT INTO ring_netlify.integration_events(event_id,merchant_id,provider,event_type)
       VALUES($1,$2,$3,$4) ON CONFLICT(event_id) DO NOTHING`,
      [id, merchantId, provider, type],
    );
  }
}
