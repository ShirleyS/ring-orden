import type {
  Repository,
  StoredState,
  TenantState,
  Membership,
  Invitation,
} from "./types.ts";
export class D1Repository implements Repository {
  db: D1Database;
  constructor(db: D1Database) {
    this.db = db;
  }
  async load(merchantId: string, ownerId: string) {
    const row = await this.db
      .prepare(
        "SELECT s.payload,s.revision FROM tenant_state s JOIN merchants m ON m.id=s.merchant_id WHERE s.merchant_id=? AND (m.owner_user_id=? OR EXISTS(SELECT 1 FROM merchant_memberships u WHERE u.merchant_id=m.id AND u.user_subject=?))",
      )
      .bind(merchantId, ownerId, ownerId)
      .first<{ payload: string; revision: number }>();
    return row
      ? {
          state: JSON.parse(row.payload) as TenantState,
          revision: row.revision,
        }
      : null;
  }
  async loadByMerchant(merchantId: string) {
    const row = await this.db
      .prepare("SELECT payload,revision FROM tenant_state WHERE merchant_id=?")
      .bind(merchantId)
      .first<{ payload: string; revision: number }>();
    return row
      ? {
          state: JSON.parse(row.payload) as TenantState,
          revision: row.revision,
        }
      : null;
  }
  async create(merchantId: string, ownerId: string, state: TenantState) {
    await this.db.batch([
      this.db
        .prepare(
          "INSERT OR IGNORE INTO merchants (id,owner_user_id,name,created_at) VALUES (?,?,?,?)",
        )
        .bind(
          merchantId,
          ownerId,
          state.merchant.name,
          new Date().toISOString(),
        ),
      this.db
        .prepare(
          "INSERT OR IGNORE INTO tenant_state (merchant_id,revision,payload,updated_at) VALUES (?,0,?,?)",
        )
        .bind(merchantId, JSON.stringify(state), new Date().toISOString()),
    ]);
  }
  async save(
    merchantId: string,
    ownerId: string,
    revision: number,
    state: TenantState,
  ) {
    const result = await this.db
      .prepare(
        "UPDATE tenant_state SET payload=?,revision=revision+1,updated_at=? WHERE merchant_id=? AND revision=? AND EXISTS (SELECT 1 FROM merchants WHERE id=? AND (owner_user_id=? OR EXISTS(SELECT 1 FROM merchant_memberships u WHERE u.merchant_id=merchants.id AND u.user_subject=?)))",
      )
      .bind(
        JSON.stringify(state),
        new Date().toISOString(),
        merchantId,
        revision,
        merchantId,
        ownerId,
        ownerId,
      )
      .run();
    return result.meta.changes === 1;
  }
  async listMemberships(subject: string): Promise<Membership[]> {
    const result = await this.db
      .prepare(
        "SELECT id AS merchant_id,owner_user_id AS subject,'' AS email,name,'OWNER' AS role FROM merchants WHERE owner_user_id=? UNION ALL SELECT merchant_id,user_subject AS subject,email,name,role FROM merchant_memberships WHERE user_subject=?",
      )
      .bind(subject, subject)
      .all<Membership>();
    return result.results;
  }
  async createInvitation(invitation: Invitation, ownerSubject: string) {
    const result = await this.db
      .prepare(
        "INSERT INTO merchant_invitations (id,merchant_id,token_hash,email,name,role,expires_at,created_at) SELECT ?,?,?,?,?,?,?,? FROM merchants WHERE id=? AND owner_user_id=?",
      )
      .bind(
        invitation.id,
        invitation.merchant_id,
        invitation.token_hash,
        invitation.email,
        invitation.name,
        invitation.role,
        invitation.expires_at,
        invitation.created_at,
        invitation.merchant_id,
        ownerSubject,
      )
      .run();
    if (result.meta.changes !== 1)
      throw new Error("Only the owner can create an invitation.");
  }
  async getInvitation(hash: string) {
    return this.db
      .prepare(
        "SELECT id,merchant_id,token_hash,email,name,role,expires_at,created_at,accepted_by,accepted_at FROM merchant_invitations WHERE token_hash=?",
      )
      .bind(hash)
      .first<Invitation>();
  }
  async acceptInvitation(
    hash: string,
    subject: string,
    email: string,
  ): Promise<Invitation | null> {
    const now = new Date().toISOString();
    const result = await this.db.batch([
      this.db
        .prepare(
          "UPDATE merchant_invitations SET accepted_by=?,accepted_at=? WHERE token_hash=? AND accepted_by IS NULL AND expires_at>? AND lower(email)=?",
        )
        .bind(subject, now, hash, now, email.toLowerCase()),
      this.db
        .prepare(
          "INSERT INTO merchant_memberships (id,merchant_id,user_subject,email,name,role,created_at) SELECT merchant_id||':'||?,merchant_id,?,email,name,role,? FROM merchant_invitations WHERE token_hash=? AND accepted_by=? AND accepted_at=? ON CONFLICT(id) DO UPDATE SET role=excluded.role,email=excluded.email,name=excluded.name",
        )
        .bind(subject, subject, now, hash, subject, now),
    ]);
    return result[0].meta.changes === 1 ? this.getInvitation(hash) : null;
  }
  async saveTrusted(merchantId: string, revision: number, state: TenantState) {
    const result = await this.db
      .prepare(
        "UPDATE tenant_state SET payload=?,revision=revision+1,updated_at=? WHERE merchant_id=? AND revision=?",
      )
      .bind(
        JSON.stringify(state),
        new Date().toISOString(),
        merchantId,
        revision,
      )
      .run();
    return result.meta.changes === 1;
  }
  async hasEvent(id: string) {
    return !!(await this.db
      .prepare("SELECT id FROM integration_events WHERE id=?")
      .bind(id)
      .first());
  }
  async recordEvent(
    id: string,
    merchantId: string,
    provider: string,
    type: string,
  ) {
    await this.db
      .prepare(
        "INSERT OR IGNORE INTO integration_events (id,merchant_id,provider,event_type,created_at) VALUES (?,?,?,?,?)",
      )
      .bind(id, merchantId, provider, type, new Date().toISOString())
      .run();
  }
}
/** Test double; production never falls back to volatile memory storage. */
export class MemoryRepository implements Repository {
  rows = new Map<
    string,
    { owner: string; state: TenantState; revision: number }
  >();
  events = new Set<string>();
  members: Membership[] = [];
  invitations = new Map<string, Invitation>();
  async load(id: string, owner: string) {
    const row = this.rows.get(id);
    return row &&
      (row.owner === owner ||
        this.members.some((m) => m.merchant_id === id && m.subject === owner))
      ? { state: structuredClone(row.state), revision: row.revision }
      : null;
  }
  async loadByMerchant(id: string) {
    const row = this.rows.get(id);
    return row
      ? { state: structuredClone(row.state), revision: row.revision }
      : null;
  }
  async create(id: string, owner: string, state: TenantState) {
    if (!this.rows.has(id))
      this.rows.set(id, { owner, state: structuredClone(state), revision: 0 });
  }
  async save(id: string, owner: string, revision: number, state: TenantState) {
    const row = this.rows.get(id);
    if (
      !row ||
      (row.owner !== owner &&
        !this.members.some(
          (m) => m.merchant_id === id && m.subject === owner,
        )) ||
      row.revision !== revision
    )
      return false;
    this.rows.set(id, {
      owner: row.owner,
      state: structuredClone(state),
      revision: revision + 1,
    });
    return true;
  }
  async listMemberships(subject: string): Promise<Membership[]> {
    return [
      ...[...this.rows]
        .filter(([, r]) => r.owner === subject)
        .map(([merchant_id, r]) => ({
          merchant_id,
          subject,
          email: r.state.team[0]?.email ?? "",
          name: r.state.merchant.name,
          role: "OWNER" as const,
        })),
      ...this.members.filter((m) => m.subject === subject),
    ];
  }
  async createInvitation(invitation: Invitation, ownerSubject: string) {
    if (this.rows.get(invitation.merchant_id)?.owner !== ownerSubject)
      throw new Error("Only the owner can create an invitation.");
    this.invitations.set(invitation.token_hash, structuredClone(invitation));
  }
  async getInvitation(hash: string) {
    const invite = this.invitations.get(hash);
    return invite ? structuredClone(invite) : null;
  }
  async acceptInvitation(hash: string, subject: string, email: string) {
    const invite = this.invitations.get(hash);
    if (
      !invite ||
      invite.accepted_by ||
      invite.expires_at <= new Date().toISOString() ||
      invite.email.toLowerCase() !== email.toLowerCase()
    )
      return null;
    invite.accepted_by = subject;
    invite.accepted_at = new Date().toISOString();
    const member = {
      merchant_id: invite.merchant_id,
      subject,
      email: invite.email,
      name: invite.name,
      role: invite.role,
    };
    const existing = this.members.findIndex(
      (m) => m.merchant_id === member.merchant_id && m.subject === subject,
    );
    if (existing >= 0) this.members[existing] = member;
    else this.members.push(member);
    return structuredClone(invite);
  }
  async saveTrusted(id: string, revision: number, state: TenantState) {
    const row = this.rows.get(id);
    return row ? this.save(id, row.owner, revision, state) : false;
  }
  async hasEvent(id: string) {
    return this.events.has(id);
  }
  async recordEvent(id: string) {
    this.events.add(id);
  }
}
