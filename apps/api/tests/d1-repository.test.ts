import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { D1Repository } from "../src/repository.ts";
import { seedTenant } from "../src/seed.ts";
function sqliteD1() {
  const sql = new DatabaseSync(":memory:");
  sql.exec("PRAGMA foreign_keys = ON");
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
  const prepare = (query: string) => {
    let args: any[] = [];
    return {
      bind(...values: any[]) {
        args = values;
        return this;
      },
      async first() {
        return sql.prepare(query).get(...args) ?? null;
      },
      async all() {
        return { results: sql.prepare(query).all(...args), success: true };
      },
      async run() {
        const result = sql.prepare(query).run(...args);
        return { success: true, meta: { changes: Number(result.changes) } };
      },
    };
  };
  const db = {
    prepare,
    async batch(statements: { run: () => Promise<unknown> }[]) {
      sql.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sql.exec("COMMIT");
        return results;
      } catch (error) {
        sql.exec("ROLLBACK");
        throw error;
      }
    },
  };
  return { repo: new D1Repository(db as unknown as D1Database), sql };
}
test("actual SQLite D1 statements enforce ownership, CAS and persisted invitation membership", async () => {
  const { repo, sql } = sqliteD1();
  try {
    const state = seedTenant(
      "merchant-sql",
      {
        id: "owner",
        name: "Owner",
        email: "owner@example.com",
        provider: "sites",
      },
      false,
    );
    await repo.create(state.merchant.id, "owner", state);
    assert.equal((await repo.load(state.merchant.id, "owner"))?.revision, 0);
    assert.equal(await repo.load(state.merchant.id, "stranger"), null);
    const invite = {
      id: "invite-sql",
      merchant_id: state.merchant.id,
      token_hash: "hash",
      email: "staff@example.com",
      name: "Staff",
      role: "STAFF" as const,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      created_at: new Date().toISOString(),
    };
    await assert.rejects(repo.createInvitation(invite, "stranger"), /owner/i);
    await repo.createInvitation(invite, "owner");
    assert.equal(
      await repo.acceptInvitation("hash", "staff", "wrong@example.com"),
      null,
    );
    assert.ok(
      await repo.acceptInvitation("hash", "staff", "staff@example.com"),
    );
    assert.equal(
      await repo.acceptInvitation("hash", "staff", "staff@example.com"),
      null,
    );
    assert.equal((await repo.listMemberships("staff"))[0].role, "STAFF");
    assert.equal((await repo.listMemberships("owner"))[0].role, "OWNER");
    const loaded = await repo.load(state.merchant.id, "staff");
    assert.ok(loaded);
    loaded.state.merchant.name = "Updated";
    assert.equal(
      await repo.save(
        state.merchant.id,
        "staff",
        loaded.revision,
        loaded.state,
      ),
      true,
    );
    assert.equal(
      await repo.save(
        state.merchant.id,
        "staff",
        loaded.revision,
        loaded.state,
      ),
      false,
    );
    assert.equal(
      await repo.save(state.merchant.id, "stranger", 1, loaded.state),
      false,
    );
  } finally {
    sql.close();
  }
});
