import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { NetlifyRepository } from "../src/netlify-repository.ts";
import { seedTenant } from "../src/seed.ts";
import type { TenantState, Invitation } from "../src/types.ts";

const moduleName = "@electric-sql/pglite";
const { PGlite } = await import(moduleName);
const database = new PGlite();
const migration = await readFile(
  new URL(
    "../../../netlify/database/migrations/202610270001_ring_orden.sql",
    import.meta.url,
  ),
  "utf8",
);
await database.exec(migration);
const repo = new NetlifyRepository(async (text, params = []) => {
  const result = await database.query(text, params);
  return result.rows as Record<string, unknown>[];
});
const state = (
  merchant = "merchant-netlify",
  owner = "owner-netlify",
): TenantState =>
  seedTenant(
    merchant,
    {
      id: owner,
      email: owner + "@example.com",
      name: "Netlify Owner",
      provider: "sites",
    },
    false,
  );
const invitation = (id: string, email = "staff@example.com"): Invitation => ({
  id,
  merchant_id: "merchant-netlify",
  token_hash: "hash-" + id,
  email,
  name: "Staff Member",
  role: "STAFF",
  created_at: new Date().toISOString(),
  expires_at: new Date(Date.now() + 3600_000).toISOString(),
});

test("Netlify Postgres persists an owner-scoped state and rejects foreign identity", async () => {
  await repo.create("merchant-netlify", "owner-netlify", state());
  assert.equal(
    (await repo.load("merchant-netlify", "owner-netlify"))?.state.merchant.id,
    "merchant-netlify",
  );
  assert.equal(await repo.load("merchant-netlify", "foreign-owner"), null);
  assert.equal((await repo.loadByMerchant("merchant-netlify"))?.revision, 0);
});
test("Netlify compare-and-swap rejects stale writes and foreign merchant changes", async () => {
  const next = state();
  next.merchant.name = "Updated once";
  assert.equal(
    await repo.save("merchant-netlify", "foreign-owner", 0, next),
    false,
  );
  assert.equal(
    await repo.save("merchant-netlify", "owner-netlify", 0, next),
    true,
  );
  next.merchant.name = "Stale overwrite";
  assert.equal(
    await repo.save("merchant-netlify", "owner-netlify", 0, next),
    false,
  );
  assert.equal(
    (await repo.load("merchant-netlify", "owner-netlify"))?.state.merchant.name,
    "Updated once",
  );
  assert.equal(
    await repo.saveTrusted("merchant-netlify", 1, state("foreign-merchant")),
    false,
  );
  assert.equal(
    await repo.save(
      "merchant-netlify",
      "owner-netlify",
      1,
      state("foreign-merchant"),
    ),
    false,
  );
});
test("existing merchant cannot be taken over or reseeded", async () => {
  await assert.rejects(
    repo.create("merchant-netlify", "attacker", state()),
    /ownership/i,
  );
  await repo.create("merchant-netlify", "owner-netlify", state());
  assert.equal(
    (await repo.load("merchant-netlify", "owner-netlify"))?.state.merchant.name,
    "Updated once",
  );
});
test("Postgres invitations require owner and are email-bound, single use, persistent members", async () => {
  const invite = invitation("valid");
  await assert.rejects(repo.createInvitation(invite, "attacker"), /owner/i);
  await repo.createInvitation(invite, "owner-netlify");
  assert.equal(
    await repo.acceptInvitation(
      invite.token_hash,
      "staff-subject",
      "wrong@example.com",
    ),
    null,
  );
  assert.equal(
    (await repo.getInvitation(invite.token_hash))?.accepted_by,
    null,
  );
  const accepted = await repo.acceptInvitation(
    invite.token_hash,
    "staff-subject",
    "STAFF@EXAMPLE.COM",
  );
  assert.equal(accepted?.accepted_by, "staff-subject");
  assert.equal(accepted?.role, "STAFF");
  assert.equal(typeof accepted?.expires_at, "string");
  assert.equal(
    await repo.acceptInvitation(
      invite.token_hash,
      "second-subject",
      invite.email,
    ),
    null,
  );
  assert.equal((await repo.listMemberships("staff-subject"))[0]?.role, "STAFF");
  assert.ok(await repo.load("merchant-netlify", "staff-subject"));
  const revision = (await repo.load("merchant-netlify", "staff-subject"))!
    .revision;
  assert.equal(
    await repo.save("merchant-netlify", "staff-subject", revision, state()),
    true,
  );
  assert.equal((await repo.listMemberships("owner-netlify"))[0]?.role, "OWNER");
});
test("expired invitations cannot create membership", async () => {
  const invite = {
    ...invitation("expired", "expired@example.com"),
    expires_at: "2000-01-01T00:00:00.000Z",
  };
  await repo.createInvitation(invite, "owner-netlify");
  assert.equal(
    await repo.acceptInvitation(
      invite.token_hash,
      "expired-subject",
      invite.email,
    ),
    null,
  );
  assert.deepEqual(await repo.listMemberships("expired-subject"), []);
});
test("provider event deduplication remains stable across duplicate inserts", async () => {
  assert.equal(await repo.hasEvent("evt-real-provider"), false);
  await repo.recordEvent(
    "evt-real-provider",
    "merchant-netlify",
    "stripe",
    "checkout.session.completed",
  );
  await repo.recordEvent(
    "evt-real-provider",
    "merchant-netlify",
    "stripe",
    "checkout.session.completed",
  );
  assert.equal(await repo.hasEvent("evt-real-provider"), true);
  const rows = await database.query(
    "SELECT count(*)::int AS total FROM ring_netlify.integration_events WHERE event_id=$1",
    ["evt-real-provider"],
  );
  assert.equal(rows.rows[0].total, 1);
});
test("application users cannot query private storage directly", async () => {
  await database.exec("CREATE ROLE ring_netlify_browser");
  try {
    await database.exec("SET ROLE ring_netlify_browser");
    await assert.rejects(
      database.query("SELECT payload FROM ring_netlify.app_state"),
      /permission denied/i,
    );
  } finally {
    await database.exec("RESET ROLE");
  }
});
test("parameterized values cannot alter SQL or cross tenant state", async () => {
  const subject = "intruder' OR TRUE --";
  assert.equal(await repo.load("merchant-netlify", subject), null);
  assert.equal(await repo.save("merchant-netlify", subject, 2, state()), false);
  assert.deepEqual(await repo.listMemberships(subject), []);
});
test.after(async () => {
  await database.close();
});

test("concurrent Postgres updates have exactly one compare-and-swap winner", async () => {
  const first = state("concurrent-merchant", "concurrent-owner");
  await repo.create("concurrent-merchant", "concurrent-owner", first);
  const a = structuredClone(first);
  a.merchant.name = "First concurrent writer";
  const b = structuredClone(first);
  b.merchant.name = "Second concurrent writer";
  const writes = await Promise.all([
    repo.save("concurrent-merchant", "concurrent-owner", 0, a),
    repo.save("concurrent-merchant", "concurrent-owner", 0, b),
  ]);
  assert.equal(writes.filter(Boolean).length, 1);
  assert.equal(
    (await repo.load("concurrent-merchant", "concurrent-owner"))?.revision,
    1,
  );
});
test("membership failure rolls back invitation consumption atomically", async () => {
  const invite = {
    ...invitation("rollback", "rollback@example.com"),
    name: "Break Membership",
  };
  await repo.createInvitation(invite, "owner-netlify");
  await database.exec(
    `CREATE FUNCTION ring_netlify.test_reject_member() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.name='Break Membership' THEN RAISE EXCEPTION 'deliberate member validation failure';END IF;RETURN NEW;END;$$; CREATE TRIGGER test_reject_member BEFORE INSERT ON ring_netlify.memberships FOR EACH ROW EXECUTE FUNCTION ring_netlify.test_reject_member();`,
  );
  try {
    await assert.rejects(
      repo.acceptInvitation(
        invite.token_hash,
        "rollback-subject",
        invite.email,
      ),
      /deliberate/,
    );
    assert.equal(
      (await repo.getInvitation(invite.token_hash))?.accepted_by,
      null,
    );
    assert.deepEqual(await repo.listMemberships("rollback-subject"), []);
  } finally {
    await database.exec(
      "DROP TRIGGER test_reject_member ON ring_netlify.memberships;DROP FUNCTION ring_netlify.test_reject_member();",
    );
  }
});
test("every Netlify storage table has row-level security enabled", async () => {
  const result = await database.query(
    "SELECT c.relname,c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='ring_netlify' AND c.relkind='r'",
  );
  assert.equal(result.rows.length, 4);
  assert.ok(result.rows.every((r: any) => r.relrowsecurity === true));
});
