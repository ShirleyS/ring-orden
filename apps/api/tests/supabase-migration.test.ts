import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { prepareSupabaseMigration } from "../src/supabase-migration.ts";
import { HttpError, type RuntimeEnv } from "../src/auth.ts";
import { seedTenant } from "../src/seed.ts";

function sourceDatabase() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys=ON");
  for (const file of [
    "0000_typical_daredevil.sql",
    "0001_chemical_hairball.sql",
  ])
    sql.exec(
      readFileSync(
        new URL("../../../drizzle/" + file, import.meta.url),
        "utf8",
      ),
    );
  const state = seedTenant(
    "source-merchant",
    {
      id: "sites:source-owner",
      email: "owner@example.com",
      name: "Owner",
      provider: "sites",
    },
    false,
  );
  sql
    .prepare("INSERT INTO merchants VALUES (?,?,?,?)")
    .run(
      "source-merchant",
      "sites:source-owner",
      "Original D1 café",
      "2026-01-01T00:00:00.000Z",
    );
  sql
    .prepare("INSERT INTO tenant_state VALUES (?,?,?,?)")
    .run(
      "source-merchant",
      7,
      JSON.stringify(state),
      "2026-01-02T00:00:00.000Z",
    );
  sql
    .prepare("INSERT INTO merchant_memberships VALUES (?,?,?,?,?,?,?)")
    .run(
      "source-member",
      "source-merchant",
      "sites:staff",
      "staff@example.com",
      "Staff",
      "STAFF",
      "2026-01-01T00:00:00.000Z",
    );
  sql
    .prepare("INSERT INTO merchant_invitations VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(
      "source-invite",
      "source-merchant",
      "token-hash",
      "invite@example.com",
      "Invite",
      "MANAGER",
      "2030-01-01T00:00:00.000Z",
      null,
      null,
      "2026-01-01T00:00:00.000Z",
    );
  sql
    .prepare("INSERT INTO integration_events VALUES (?,?,?,?,?)")
    .run(
      "source-event",
      "source-merchant",
      "stripe",
      "checkout.session.completed",
      "2026-01-01T00:00:00.000Z",
    );
  let batches = 0;
  const queries: string[] = [];
  const db = {
    prepare(query: string) {
      queries.push(query);
      return { query };
    },
    async batch(statements: { query: string }[]) {
      batches++;
      sql.exec("BEGIN");
      try {
        const result = statements.map(({ query }) => ({
          results: sql.prepare(query).all(),
          success: true,
          meta: { changes: 0 },
        }));
        sql.exec("COMMIT");
        return result;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  } as unknown as D1Database;
  const snapshot = () =>
    JSON.stringify(
      [
        "merchants",
        "tenant_state",
        "merchant_memberships",
        "merchant_invitations",
        "integration_events",
      ].map((table) => sql.prepare("SELECT * FROM " + table).all()),
    );
  return { sql, db, state, snapshot, queries, batches: () => batches };
}
function runtime(db?: D1Database): RuntimeEnv {
  return {
    SUPABASE_MIGRATE_D1: "true",
    DB: db,
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_SERVER_SECRET: "sb_secret_never_log",
  };
}
function gateway(
  options: {
    complete?: boolean;
    timeoutAfterCommit?: boolean;
    rejectImport?: boolean;
  } = {},
) {
  let complete = options.complete ?? false;
  let statusCalls = 0;
  const imported: any[] = [];
  const headers: Headers[] = [];
  const request: typeof fetch = async (input, init) => {
    headers.push(new Headers(init?.headers));
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    if (String(input).endsWith("/rpc/ring_d1_cutover_status")) {
      statusCalls++;
      return Response.json(complete);
    }
    assert.equal(
      String(input),
      "https://project.supabase.co/rest/v1/rpc/ring_import_d1_snapshot",
    );
    const body = JSON.parse(String(init?.body));
    imported.push(body.p_snapshot);
    if (options.rejectImport) return Response.json({ completed: false });
    complete = true;
    if (options.timeoutAfterCommit)
      throw new Error("sb_secret_never_log network timeout after commit");
    return Response.json({ completed: true, already_imported: false });
  };
  return { request, imported, headers, statusCalls: () => statusCalls };
}

test("D1 cutover is opt-in and completed status skips all source database reads", async () => {
  const source = sourceDatabase();
  try {
    const api = gateway({ complete: true });
    await prepareSupabaseMigration(
      { ...runtime(source.db), SUPABASE_MIGRATE_D1: "false" },
      api.request,
    );
    await prepareSupabaseMigration(
      { ...runtime(source.db), SUPABASE_MIGRATE_D1: undefined },
      api.request,
    );
    assert.equal(api.statusCalls(), 0);
    await prepareSupabaseMigration(runtime(source.db), api.request);
    assert.equal(api.statusCalls(), 1);
    assert.equal(source.batches(), 0);
    assert.deepEqual(source.queries, []);
    assert.equal(api.imported.length, 0);
  } finally {
    source.sql.close();
  }
});

test("enabled migration fails closed without the source binding or complete server credentials", async () => {
  const source = sourceDatabase();
  try {
    for (const env of [
      runtime(),
      { ...runtime(source.db), SUPABASE_URL: undefined },
      { ...runtime(source.db), SUPABASE_SERVER_SECRET: undefined },
      { ...runtime(source.db), SUPABASE_URL: "http://project.supabase.co" },
    ]) {
      await assert.rejects(prepareSupabaseMigration(env), (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.message.includes("sb_secret_never_log"), false);
        return true;
      });
    }
    assert.equal(source.batches(), 0);
  } finally {
    source.sql.close();
  }
});

test("one transactional batch preserves all five source tables and exact state/revision without source writes", async () => {
  const source = sourceDatabase();
  try {
    const before = source.snapshot();
    const api = gateway();
    await prepareSupabaseMigration(runtime(source.db), api.request);
    assert.equal(source.batches(), 1);
    assert.equal(source.queries.length, 5);
    assert.ok(source.queries.every((query) => /^SELECT\b/.test(query)));
    assert.equal(source.snapshot(), before);
    assert.equal(api.imported.length, 1);
    const data = api.imported[0];
    assert.deepEqual(
      Object.keys(data).sort(),
      [
        "source",
        "merchants",
        "tenant_state",
        "merchant_memberships",
        "merchant_invitations",
        "integration_events",
      ].sort(),
    );
    assert.equal(data.source, "sites-d1-v1");
    assert.equal(data.merchants[0].owner_user_id, "sites:source-owner");
    assert.equal(data.tenant_state[0].revision, 7);
    assert.deepEqual(data.tenant_state[0].payload, source.state);
    assert.equal(data.merchant_memberships[0].user_subject, "sites:staff");
    assert.equal(data.merchant_invitations[0].token_hash, "token-hash");
    assert.equal(data.integration_events[0].id, "source-event");
    assert.ok(
      api.headers.every((h) => h.get("apikey") === "sb_secret_never_log"),
    );
    assert.ok(api.headers.every((h) => !h.has("Authorization")));
  } finally {
    source.sql.close();
  }
});

test("an ambiguous committed import retries using the marker without rescanning D1", async () => {
  const source = sourceDatabase();
  try {
    const api = gateway({ timeoutAfterCommit: true });
    await assert.rejects(
      prepareSupabaseMigration(runtime(source.db), api.request),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.message.includes("sb_secret_never_log"), false);
        return true;
      },
    );
    await prepareSupabaseMigration(runtime(source.db), api.request);
    assert.equal(source.batches(), 1);
    assert.equal(api.imported.length, 1);
    assert.equal(api.statusCalls(), 2);
  } finally {
    source.sql.close();
  }
});

test("failed status checks stop cutover before reading source state and redact remote errors", async () => {
  const source = sourceDatabase();
  try {
    const request: typeof fetch = async () =>
      new Response("sb_secret_never_log private error", { status: 403 });
    await assert.rejects(
      prepareSupabaseMigration(runtime(source.db), request),
      (error) => {
        assert.ok(error instanceof HttpError);
        assert.equal(error.status, 503);
        assert.equal(error.message.includes("sb_secret_never_log"), false);
        return true;
      },
    );
    assert.equal(source.batches(), 0);
  } finally {
    source.sql.close();
  }
});

test("malformed source payload cannot be imported or silently replaced", async () => {
  const source = sourceDatabase();
  try {
    source.sql.exec("UPDATE tenant_state SET payload='not-json'");
    const before = source.snapshot();
    const api = gateway();
    await assert.rejects(
      prepareSupabaseMigration(runtime(source.db), api.request),
      { status: 503 },
    );
    assert.equal(api.imported.length, 0);
    assert.equal(source.snapshot(), before);
  } finally {
    source.sql.close();
  }
});

test("failed or partial D1 snapshot and non-completed imports block application cutover", async () => {
  const source = sourceDatabase();
  try {
    const api = gateway();
    const broken = {
      prepare: source.db.prepare.bind(source.db),
      batch: async () => [{ success: false, results: [] }],
    } as unknown as D1Database;
    await assert.rejects(
      prepareSupabaseMigration(runtime(broken), api.request),
      { status: 503 },
    );
    assert.equal(api.imported.length, 0);
    const rejected = gateway({ rejectImport: true });
    await assert.rejects(
      prepareSupabaseMigration(runtime(source.db), rejected.request),
      { status: 503 },
    );
  } finally {
    source.sql.close();
  }
});
