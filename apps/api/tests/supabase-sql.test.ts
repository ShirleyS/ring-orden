import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { seedTenant } from "../src/seed.ts";
import type { Invitation, TenantState } from "../src/types.ts";
import { createOrder } from "../../../packages/ring-orden-core/src/index.ts";
import {
  handleCustomerTool,
  handleCustomerMerchant,
} from "../src/customer-memory.ts";
import { queueCustomerAutomation } from "../src/customer-automation.ts";

const moduleName = "@electric-sql/pglite";
const vectorModule = "@electric-sql/pglite/vector";
const cryptoModule = "@electric-sql/pglite/contrib/pgcrypto";
const { PGlite } = await import(moduleName);
const { vector } = await import(vectorModule);
const { pgcrypto } = await import(cryptoModule);
const database = new PGlite({ extensions: { vector, pgcrypto } });

// Emulate only Supabase-provided infrastructure. Both application migration
// files below execute unchanged, including vector SQL, RLS and RPC grants.
await database.exec(`
  CREATE ROLE anon;
  CREATE ROLE authenticated;
  CREATE ROLE service_role BYPASSRLS;
  CREATE SCHEMA extensions;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO authenticated;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
  $$;
  CREATE PUBLICATION supabase_realtime;
`);
for (const file of [
  "20261027225425_ring_orden.sql",
  "20261027230839_ring_orden_runtime.sql",
  "20261028000753_ring_orden_cutover.sql",
]) {
  const sql = await readFile(
    new URL("../../../database/supabase/migrations/" + file, import.meta.url),
    "utf8",
  );
  await database.exec(sql);
}

type Row = Record<string, any>;
async function asRole(
  role: "anon" | "authenticated" | "service_role",
  sql: string,
  params: unknown[] = [],
  claims?: Record<string, unknown>,
): Promise<Row[]> {
  return database.transaction(async (tx: any) => {
    await tx.exec("SET LOCAL ROLE " + role);
    if (claims)
      await tx.query("SELECT set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims),
      ]);
    return (await tx.query(sql, params)).rows;
  });
}
async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  assert.match(name, /^ring_[a-z0-9_]+$/);
  const entries = Object.entries(args);
  for (const [key] of entries) assert.match(key, /^p_[a-z_]+$/);
  const parameters = entries.map(([key], index) => key + " => $" + (index + 1));
  const values = entries.map(([, value]) =>
    value !== null && typeof value === "object" ? JSON.stringify(value) : value,
  );
  const rows = await asRole(
    "service_role",
    "SELECT public." + name + "(" + parameters.join(", ") + ") AS value",
    values,
  );
  return rows[0].value as T;
}
const state = (
  merchant = "supabase-sql-a",
  subject = "supabase-owner-a",
): TenantState =>
  seedTenant(
    merchant,
    {
      id: subject,
      email: subject + "@example.com",
      name: "Supabase Owner",
      provider: "sites",
    },
    false,
  );
const create = (
  merchant: string,
  subject: string,
  payload = state(merchant, subject),
) =>
  rpc<boolean>("ring_create_state", {
    p_merchant_id: merchant,
    p_subject: subject,
    p_payload: payload,
  });
const load = (merchant: string, subject: string) =>
  rpc<{ state: TenantState; revision: number } | null>("ring_load_state", {
    p_merchant_id: merchant,
    p_subject: subject,
  });
const save = (
  merchant: string,
  subject: string,
  revision: number,
  payload: TenantState,
) =>
  rpc<boolean>("ring_save_state", {
    p_merchant_id: merchant,
    p_subject: subject,
    p_revision: revision,
    p_payload: payload,
  });
const invite = (id: string, email = "staff@example.com"): Invitation => ({
  id,
  merchant_id: "supabase-sql-a",
  token_hash: "token-" + id,
  email,
  name: "Staff",
  role: "STAFF",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
});
const createInvitation = (invitation: Invitation, owner = "supabase-owner-a") =>
  rpc<boolean>("ring_create_invitation", {
    p_invitation: invitation,
    p_owner_subject: owner,
  });
const accept = (hash: string, subject: string, email: string) =>
  rpc<Invitation | null>("ring_accept_invitation", {
    p_hash: hash,
    p_subject: subject,
    p_email: email,
  });
const memberships = (subject: string) =>
  rpc<Row[]>("ring_memberships", { p_subject: subject });

test("existing SQL RPCs durably preserve customer memory and encrypted jobs with tenant and revision checks", async () => {
  const tenant = "customer-sql-persistence";
  const owner = "customer-sql-owner";
  const payload = state(tenant, owner);
  const order = createOrder(tenant);
  order.customer = { name: "Ana", phone: "+525555550123" };
  payload.orders.push(order);
  payload.order_metadata[order.id] = {
    pos_status: "DASHBOARD_ONLY",
    notification_status: "PENDING",
    demo: false,
  };
  const session = {
    id: "customer-sql-session",
    order_id: order.id,
    turns: [],
    status: "ACTIVE",
    created_at: new Date().toISOString(),
    pending_corrections: [],
  };
  payload.sessions.push(session);
  const context = (await handleCustomerTool(
    payload,
    "get_customer_context",
    {},
    session,
    {},
  )) as { customer_id: string };
  handleCustomerMerchant(
    payload,
    ["customers", context.customer_id, "preferences"],
    "POST",
    {
      preference_key: "milk",
      preference_value: "oat",
      scope: "permanent",
      confirmed: true,
    },
    "OWNER",
  );
  await queueCustomerAutomation(
    payload,
    { order_id: order.id, purpose: "recovery", consent: true },
    {
      AGENT_TOOL_SECRET: "synthetic-durable-sql-secret",
      CUSTOMER_APP_ORIGIN: "https://order.example",
    },
  );
  await create(tenant, owner, payload);
  const reloaded = await load(tenant, owner);
  assert.ok(reloaded);
  assert.equal(reloaded.state.customer_memory!.preferences[0].value, "oat");
  assert.ok(reloaded.state.customer_automation!.jobs[0].encrypted_link);
  assert.equal(
    JSON.stringify(reloaded.state.customer_automation).includes(
      "https://order.example",
    ),
    false,
  );
  assert.equal(await load(tenant, "another-owner"), null);
  assert.equal(
    await save(tenant, "another-owner", reloaded.revision, reloaded.state),
    false,
  );
  assert.equal(
    await save(tenant, owner, reloaded.revision + 1, reloaded.state),
    false,
  );
  assert.equal(
    await save(tenant, owner, reloaded.revision, reloaded.state),
    true,
  );
  await assert.rejects(
    () => asRole("anon", "SELECT public.ring_load_trusted_state($1)", [tenant]),
    /permission denied/i,
  );
});

test("all Supabase migrations compile, including vector retrieval and publication", async () => {
  const functions = await database.query(
    "SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND (proname LIKE 'ring_%' OR proname='match_correction_memories')",
  );
  assert.equal(functions.rows.length, 14);
  const extensions = await database.query(
    "SELECT extname FROM pg_extension WHERE extname IN ('vector','pgcrypto')",
  );
  assert.equal(extensions.rows.length, 2);
  const publication = await database.query(
    "SELECT tablename FROM pg_publication_tables WHERE pubname='supabase_realtime' ORDER BY tablename",
  );
  assert.deepEqual(
    publication.rows.map((r: Row) => r.tablename),
    ["correction_memories", "escalations", "orders"],
  );
});

test("every runtime RPC is service-only and browser calls are denied", async () => {
  const rows = await database.query(`
    SELECT p.proname,
      has_function_privilege('anon',p.oid,'EXECUTE') AS anon_allowed,
      has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_allowed,
      has_function_privilege('service_role',p.oid,'EXECUTE') AS service_allowed,
      p.prosecdef,
      p.proconfig
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname LIKE 'ring_%'
  `);
  assert.equal(rows.rows.length, 13);
  for (const row of rows.rows as Row[]) {
    assert.equal(row.anon_allowed, false, row.proname);
    assert.equal(row.authenticated_allowed, false, row.proname);
    assert.equal(row.service_allowed, true, row.proname);
    assert.equal(row.prosecdef, true, row.proname);
    assert.ok(row.proconfig.includes('search_path=""'), row.proname);
  }
  for (const role of ["anon", "authenticated"] as const) {
    await assert.rejects(
      asRole(role, "SELECT public.ring_load_trusted_state('supabase-sql-a')"),
      /permission denied/i,
    );
  }
});

test("all application tables use RLS and private runtime tables have no browser grants", async () => {
  const tables = await database.query(`
    SELECT n.nspname,c.relname,c.relrowsecurity
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname IN ('public','ring_private') AND c.relkind='r'
  `);
  assert.ok(tables.rows.length > 20);
  for (const row of tables.rows as Row[])
    assert.equal(row.relrowsecurity, true, row.nspname + "." + row.relname);
  for (const table of [
    "app_state",
    "processed_events",
    "merchant_invitations",
  ]) {
    for (const role of ["anon", "authenticated"] as const) {
      const allowed = await database.query(
        "SELECT has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') AS allowed",
        [role, "ring_private." + table],
      );
      assert.equal(allowed.rows[0].allowed, false, role + " " + table);
      await assert.rejects(
        asRole(role, "SELECT * FROM ring_private." + table),
        /permission denied/i,
      );
    }
  }
});

test("tenant SQL checks ownership, identity and payload before state access", async () => {
  await create("supabase-sql-a", "supabase-owner-a");
  await create("supabase-sql-b", "supabase-owner-b");
  assert.equal((await load("supabase-sql-a", "supabase-owner-a"))?.revision, 0);
  assert.equal(await load("supabase-sql-a", "supabase-owner-b"), null);
  assert.equal(await load("supabase-sql-a", ""), null);
  assert.equal(await load("supabase-sql-a", "x' OR TRUE --"), null);
  await assert.rejects(
    create("mismatched-create", "supabase-owner-a", state("supabase-sql-a")),
    /Invalid merchant identity/,
  );
  await assert.rejects(create("empty-owner", ""), /Invalid merchant identity/);
  const normalized = await database.query(
    "SELECT id FROM public.merchants WHERE id IN ('mismatched-create','empty-owner')",
  );
  assert.equal(normalized.rows.length, 0);
});

test("owner identity cannot be replaced and repeated initialization preserves saved state", async () => {
  await assert.rejects(
    create("supabase-sql-a", "attacker", state("supabase-sql-a", "attacker")),
    /ownership mismatch/i,
  );
  const next = state();
  next.merchant.name = "Saved restaurant";
  assert.equal(await save("supabase-sql-a", "supabase-owner-a", 0, next), true);
  await create("supabase-sql-a", "supabase-owner-a");
  assert.equal(
    (await load("supabase-sql-a", "supabase-owner-a"))?.state.merchant.name,
    "Saved restaurant",
  );
});

test("SQL compare-and-swap rejects foreign identities, stale revisions and merchant changes", async () => {
  const next = state();
  next.merchant.name = "Second revision";
  assert.equal(
    await save("supabase-sql-a", "supabase-owner-b", 1, next),
    false,
  );
  assert.equal(
    await save("supabase-sql-a", "supabase-owner-a", 0, next),
    false,
  );
  assert.equal(
    await save(
      "supabase-sql-a",
      "supabase-owner-a",
      1,
      state("supabase-sql-b"),
    ),
    false,
  );
  assert.equal(await save("supabase-sql-a", "supabase-owner-a", 1, next), true);
  assert.equal(
    await rpc("ring_save_trusted_state", {
      p_merchant_id: "supabase-sql-a",
      p_revision: 2,
      p_payload: state("supabase-sql-b"),
    }),
    false,
  );
  assert.equal((await load("supabase-sql-a", "supabase-owner-a"))?.revision, 2);
});

test("concurrent SQL writes yield one compare-and-swap winner", async () => {
  const original = state("supabase-concurrent", "concurrent-owner");
  await create("supabase-concurrent", "concurrent-owner", original);
  const a = structuredClone(original);
  const b = structuredClone(original);
  a.merchant.name = "Writer A";
  b.merchant.name = "Writer B";
  const results = await Promise.all([
    save("supabase-concurrent", "concurrent-owner", 0, a),
    save("supabase-concurrent", "concurrent-owner", 0, b),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  const current = await load("supabase-concurrent", "concurrent-owner");
  assert.equal(current?.revision, 1);
  assert.ok(["Writer A", "Writer B"].includes(current!.state.merchant.name));
});

test("invitations require the owner, match email case-insensitively and are single use", async () => {
  const invitation = invite("sql-valid");
  await assert.rejects(
    createInvitation(invitation, "supabase-owner-b"),
    /Owner permission/,
  );
  await createInvitation(invitation);
  assert.equal(
    await accept(invitation.token_hash, "staff-subject", "wrong@example.com"),
    null,
  );
  assert.equal(await accept(invitation.token_hash, "", invitation.email), null);
  const before = await rpc<Invitation>("ring_get_invitation", {
    p_hash: invitation.token_hash,
  });
  assert.equal(before.accepted_by, null);
  const accepted = await accept(
    invitation.token_hash,
    "staff-subject",
    "STAFF@EXAMPLE.COM",
  );
  assert.equal(accepted?.accepted_by, "staff-subject");
  assert.equal(accepted?.role, "STAFF");
  assert.equal(
    await accept(invitation.token_hash, "second-subject", invitation.email),
    null,
  );
  assert.equal((await memberships("staff-subject"))[0].role, "STAFF");
  assert.equal((await memberships("supabase-owner-a"))[0].role, "OWNER");
  assert.ok(await load("supabase-sql-a", "staff-subject"));
  assert.equal(await load("supabase-sql-b", "staff-subject"), null);
});

test("expired or invalid-role invitations cannot create membership", async () => {
  const expired = {
    ...invite("sql-expired", "expired@example.com"),
    expires_at: "2000-01-01T00:00:00.000Z",
  };
  await createInvitation(expired);
  assert.equal(
    await accept(expired.token_hash, "expired-subject", expired.email),
    null,
  );
  assert.deepEqual(await memberships("expired-subject"), []);
  await assert.rejects(
    createInvitation({
      ...invite("sql-owner-role"),
      role: "OWNER",
    } as unknown as Invitation),
    /check constraint/i,
  );
});

test("invitation consumption rolls back if membership insertion fails", async () => {
  const invitation = invite("sql-rollback", "rollback@example.com");
  await createInvitation(invitation);
  await database.exec(`
    CREATE FUNCTION ring_private.test_reject_member() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.user_id='rollback-subject' THEN RAISE EXCEPTION 'deliberate membership failure'; END IF;
        RETURN NEW;
      END;
    $$;
    CREATE TRIGGER test_reject_member BEFORE INSERT ON public.merchant_users
      FOR EACH ROW EXECUTE FUNCTION ring_private.test_reject_member();
  `);
  try {
    await assert.rejects(
      accept(invitation.token_hash, "rollback-subject", invitation.email),
      /deliberate membership/,
    );
    const current = await rpc<Invitation>("ring_get_invitation", {
      p_hash: invitation.token_hash,
    });
    assert.equal(current.accepted_by, null);
    assert.deepEqual(await memberships("rollback-subject"), []);
  } finally {
    await database.exec(
      "DROP TRIGGER test_reject_member ON public.merchant_users; DROP FUNCTION ring_private.test_reject_member();",
    );
  }
});

test("event inserts are idempotent in the actual SQL table", async () => {
  assert.equal(await rpc("ring_has_event", { p_event_id: "evt-sql" }), false);
  const event = {
    p_event_id: "evt-sql",
    p_merchant_id: "supabase-sql-a",
    p_provider: "stripe",
    p_event_type: "checkout.session.completed",
  };
  await rpc("ring_record_event", event);
  await rpc("ring_record_event", event);
  assert.equal(await rpc("ring_has_event", { p_event_id: "evt-sql" }), true);
  const count = await database.query(
    "SELECT count(*)::int AS count FROM ring_private.processed_events WHERE event_id=$1",
    ["evt-sql"],
  );
  assert.equal(count.rows[0].count, 1);
});

test("normalized merchant RLS ignores self-assigned user metadata roles", async () => {
  const owned = await asRole(
    "authenticated",
    "SELECT id FROM public.merchants ORDER BY id",
    [],
    {
      sub: "supabase-owner-a",
    },
  );
  assert.deepEqual(
    owned.map((r) => r.id),
    ["supabase-sql-a"],
  );
  const attacker = await asRole(
    "authenticated",
    "SELECT id FROM public.merchants",
    [],
    {
      sub: "foreign-subject",
      user_metadata: { role: "OWNER", merchant_id: "supabase-sql-a" },
    },
  );
  assert.deepEqual(attacker, []);
});

const cutoverSnapshot = () => {
  const payload = state("sites-migrated", "sites:old-owner");
  payload.merchant.name = "Preserved D1 café";
  return {
    source: "sites-d1-v1",
    merchants: [
      {
        id: "sites-migrated",
        owner_user_id: "sites:old-owner",
        name: "Preserved D1 café",
        created_at: "2026-01-02T03:04:05.000Z",
      },
    ],
    tenant_state: [
      {
        merchant_id: "sites-migrated",
        revision: 42,
        payload,
        updated_at: "2026-02-03T04:05:06.000Z",
      },
    ],
    merchant_memberships: [
      {
        id: "sites-migrated:sites:staff",
        merchant_id: "sites-migrated",
        user_subject: "sites:staff",
        email: "Staff@Example.com",
        name: "Imported Staff",
        role: "STAFF",
        created_at: "2026-01-03T03:04:05.000Z",
      },
    ],
    merchant_invitations: [
      {
        id: "d1-invitation",
        merchant_id: "sites-migrated",
        token_hash: "d1-invitation-hash",
        email: "invite@example.com",
        name: "Invited Person",
        role: "MANAGER",
        expires_at: "2030-01-01T00:00:00.000Z",
        created_at: "2026-01-04T03:04:05.000Z",
        accepted_by: null,
        accepted_at: null,
      },
      {
        id: "d1-already-accepted",
        merchant_id: "sites-migrated",
        token_hash: "d1-accepted-hash",
        email: "staff@example.com",
        name: "Imported Staff",
        role: "STAFF",
        expires_at: "2030-01-01T00:00:00.000Z",
        created_at: "2026-01-04T03:04:05.000Z",
        accepted_by: "sites:staff",
        accepted_at: "2026-01-05T03:04:05.000Z",
      },
    ],
    integration_events: [
      {
        id: "evt-d1-imported",
        merchant_id: "sites-migrated",
        provider: "stripe",
        event_type: "checkout.session.completed",
        created_at: "2026-01-05T03:04:05.000Z",
      },
    ],
  };
};
const importSnapshot = (snapshot: unknown) =>
  rpc<Row>("ring_import_d1_snapshot", { p_snapshot: snapshot });

test("cutover status starts incomplete and both cutover RPCs are inaccessible to browsers", async () => {
  assert.equal(await rpc("ring_d1_cutover_status", {}), false);
  for (const role of ["anon", "authenticated"] as const) {
    await assert.rejects(
      asRole(role, "SELECT public.ring_d1_cutover_status()"),
      /permission denied/,
    );
    await assert.rejects(
      asRole(role, "SELECT public.ring_import_d1_snapshot('{}'::jsonb)"),
      /permission denied/,
    );
  }
});

test("cutover rejects incomplete snapshots and existing destination tenants without changing either", async () => {
  await assert.rejects(
    importSnapshot({ source: "sites-d1-v1", merchants: [] }),
    /snapshot/i,
  );
  const conflict = cutoverSnapshot();
  conflict.merchants[0].id = "supabase-sql-a";
  conflict.tenant_state[0].merchant_id = "supabase-sql-a";
  conflict.tenant_state[0].payload.merchant.id = "supabase-sql-a";
  await assert.rejects(importSnapshot(conflict), /conflict/i);
  assert.equal(await rpc("ring_d1_cutover_status", {}), false);
  assert.equal(
    (await load("supabase-sql-a", "supabase-owner-a"))?.state.merchant.name,
    "Second revision",
  );
  const sourceOnly = await database.query(
    "SELECT id FROM public.merchants WHERE id='sites-migrated'",
  );
  assert.equal(sourceOnly.rows.length, 0);
});

test("a failing cutover rolls back merchants, states and memberships as one transaction", async () => {
  const invalid = cutoverSnapshot();
  invalid.merchant_invitations[0].role = "OWNER";
  await assert.rejects(importSnapshot(invalid), /check constraint/i);
  assert.equal(await rpc("ring_d1_cutover_status", {}), false);
  const result = await database.query(
    "SELECT id FROM public.merchants WHERE id='sites-migrated'",
  );
  assert.equal(result.rows.length, 0);
  assert.equal(await load("sites-migrated", "sites:old-owner"), null);
  assert.deepEqual(await memberships("sites:staff"), []);
});

test("cutover preserves D1 payload, revision, owner, membership metadata, invitations and event IDs", async () => {
  const snapshot = cutoverSnapshot();
  const result = await importSnapshot(snapshot);
  assert.equal(result.completed, true);
  assert.equal(result.already_imported, false);
  assert.deepEqual(result.counts, {
    merchants: 1,
    tenant_state: 1,
    merchant_memberships: 1,
    merchant_invitations: 2,
    integration_events: 1,
  });
  assert.equal(await rpc("ring_d1_cutover_status", {}), true);
  const loaded = await load("sites-migrated", "sites:old-owner");
  assert.equal(loaded?.revision, 42);
  assert.deepEqual(loaded?.state, snapshot.tenant_state[0].payload);
  assert.equal(await load("sites-migrated", "supabase-owner-a"), null);
  const member = (await memberships("sites:staff"))[0];
  assert.equal(member.email, "Staff@Example.com");
  assert.equal(member.role, "STAFF");
  const metadata = await database.query(
    "SELECT source_id,email,name FROM public.merchant_users WHERE merchant_id='sites-migrated' AND user_id='sites:staff'",
  );
  assert.deepEqual(metadata.rows[0], {
    source_id: "sites-migrated:sites:staff",
    email: "Staff@Example.com",
    name: "Imported Staff",
  });
  const invitation = await rpc<Invitation>("ring_get_invitation", {
    p_hash: "d1-invitation-hash",
  });
  assert.equal(invitation.id, "d1-invitation");
  assert.equal(invitation.accepted_by, null);
  const used = await rpc<Invitation>("ring_get_invitation", {
    p_hash: "d1-accepted-hash",
  });
  assert.equal(used.accepted_by, "sites:staff");
  assert.equal(
    new Date(used.accepted_at!).toISOString(),
    "2026-01-05T03:04:05.000Z",
  );
  assert.equal(
    await accept("d1-accepted-hash", "attacker", "staff@example.com"),
    null,
  );
  assert.ok(
    await accept("d1-invitation-hash", "sites:invited", "invite@example.com"),
  );
  assert.equal(
    await rpc("ring_has_event", { p_event_id: "evt-d1-imported" }),
    true,
  );
  const markers = await database.query(
    "SELECT id FROM ring_private.storage_cutovers",
  );
  assert.deepEqual(markers.rows, [{ id: "sites-d1-v1" }]);
});

test("replaying a completed import never overwrites later Supabase writes", async () => {
  const next = state("sites-migrated", "sites:old-owner");
  next.merchant.name = "Changed after cutover";
  assert.equal(await save("sites-migrated", "sites:old-owner", 42, next), true);
  const result = await importSnapshot(cutoverSnapshot());
  assert.equal(result.completed, true);
  assert.equal(result.already_imported, true);
  const current = await load("sites-migrated", "sites:old-owner");
  assert.equal(current?.revision, 43);
  assert.equal(current?.state.merchant.name, "Changed after cutover");
});

test("cutover markers have RLS and no browser table privileges", async () => {
  const result = await database.query(
    "SELECT relrowsecurity FROM pg_class WHERE oid='ring_private.storage_cutovers'::regclass",
  );
  assert.equal(result.rows[0].relrowsecurity, true);
  for (const role of ["anon", "authenticated"] as const)
    await assert.rejects(
      asRole(role, "SELECT * FROM ring_private.storage_cutovers"),
      /permission denied/,
    );
});

test.after(async () => {
  await database.close();
});

test("menu extraction drafts round-trip through the actual Supabase SQL functions", async () => {
  const merchant = "menu-draft-sql",
    owner = "menu-draft-owner";
  await create(merchant, owner);
  const row = (await load(merchant, owner))!;
  row.state.menu_drafts = [
    {
      id: "draft-sql",
      label: "menu.png",
      status: "pending",
      created_at: new Date().toISOString(),
      currency: "MXN",
      warnings: ["Review prices"],
      items: [
        {
          name: "Draft Latte",
          price: null,
          category: "Coffee",
          description: "Check price",
          available: true,
        },
      ],
    },
  ];
  assert.equal(await save(merchant, owner, row.revision, row.state), true);
  const restored = (await load(merchant, owner))!;
  assert.deepEqual(restored.state.menu_drafts, row.state.menu_drafts);
  assert.equal(await load(merchant, "foreign-owner"), null);
});
