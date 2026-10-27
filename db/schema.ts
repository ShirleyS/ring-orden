import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";
/** Running private demo: one scoped state document per authenticated owner. */
export const merchants = sqliteTable("merchants", {
  id: text("id").primaryKey(),
  ownerUserId: text("owner_user_id").notNull().unique(),
  name: text("name").notNull(),
  createdAt: text("created_at").notNull(),
});
export const tenantState = sqliteTable("tenant_state", {
  merchantId: text("merchant_id")
    .primaryKey()
    .references(() => merchants.id),
  revision: integer("revision").notNull().default(0),
  payload: text("payload").notNull(),
  updatedAt: text("updated_at").notNull(),
});
export const integrationEvents = sqliteTable(
  "integration_events",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    provider: text("provider").notNull(),
    eventType: text("event_type").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [index("integration_events_tenant").on(t.merchantId, t.createdAt)],
);
export const merchantMemberships = sqliteTable(
  "merchant_memberships",
  {
    id: text("id").primaryKey(),
    merchantId: text("merchant_id")
      .notNull()
      .references(() => merchants.id),
    userSubject: text("user_subject").notNull(),
    email: text("email").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    createdAt: text("created_at").notNull(),
  },
  (t) => [
    index("merchant_memberships_subject").on(t.userSubject, t.merchantId),
  ],
);
export const merchantInvitations = sqliteTable("merchant_invitations", {
  id: text("id").primaryKey(),
  merchantId: text("merchant_id")
    .notNull()
    .references(() => merchants.id),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  expiresAt: text("expires_at").notNull(),
  acceptedBy: text("accepted_by"),
  acceptedAt: text("accepted_at"),
  createdAt: text("created_at").notNull(),
});
