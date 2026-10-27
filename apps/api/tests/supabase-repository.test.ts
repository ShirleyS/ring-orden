import test from "node:test";
import assert from "node:assert/strict";
import { SupabaseRepository } from "../src/supabase-repository.ts";
import { repositoryFor, storageStatus } from "../src/storage.ts";
import { seedTenant } from "../src/seed.ts";
const state = () =>
  seedTenant(
    "merchant-a",
    {
      id: "owner-a",
      email: "owner@example.com",
      name: "Owner",
      provider: "sites",
    },
    false,
  );
test("Supabase runtime sends merchant and verified subject to scoped RPC with server-only auth", async () => {
  const calls: {
    url: string;
    body: any;
    headers: Headers;
    redirect: RequestRedirect | undefined;
  }[] = [];
  const repo = new SupabaseRepository({
    url: "https://test.supabase.co",
    serverSecret: "sb_secret_test",
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
        redirect: init?.redirect,
      });
      return new Response(JSON.stringify({ state: state(), revision: 4 }), {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  const loaded = await repo.load("merchant-a", "verified-owner-a");
  assert.equal(loaded?.revision, 4);
  assert.equal(
    calls[0].url,
    "https://test.supabase.co/rest/v1/rpc/ring_load_state",
  );
  assert.deepEqual(calls[0].body, {
    p_merchant_id: "merchant-a",
    p_subject: "verified-owner-a",
  });
  assert.equal(calls[0].headers.get("apikey"), "sb_secret_test");
  assert.equal(calls[0].headers.has("Authorization"), false);
  assert.equal(calls[0].redirect, "error");
});
test("Supabase CAS preserves stale-revision false and invitation creation carries owner", async () => {
  const calls: any[] = [];
  const repo = new SupabaseRepository({
    url: "https://test.supabase.co",
    serverSecret: "legacy-jwt-service-role",
    fetch: async (url, init) => {
      calls.push({
        url: String(url),
        body: JSON.parse(String(init?.body)),
        headers: new Headers(init?.headers),
      });
      return new Response("false", {
        headers: { "Content-Type": "application/json" },
      });
    },
  });
  assert.equal(await repo.save("merchant-a", "owner-a", 2, state()), false);
  assert.equal(calls[0].body.p_revision, 2);
  assert.equal(calls[0].body.p_payload.merchant.id, "merchant-a");
  assert.equal(
    calls[0].headers.get("Authorization"),
    "Bearer legacy-jwt-service-role",
  );
  await repo.createInvitation(
    {
      id: "invite-a",
      merchant_id: "merchant-a",
      token_hash: "hash",
      email: "staff@example.com",
      name: "Staff",
      role: "STAFF",
      created_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 10000).toISOString(),
    },
    "owner-a",
  );
  assert.equal(calls[1].body.p_owner_subject, "owner-a");
});
test("Supabase errors redact credential and full remote body", async () => {
  const repo = new SupabaseRepository({
    url: "https://test.supabase.co",
    serverSecret: "sb_secret_private",
    fetch: async () =>
      new Response("sb_secret_private remote internal error", { status: 401 }),
  });
  await assert.rejects(repo.load("merchant-a", "owner-a"), (error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 401/);
    assert.equal(error.message.includes("sb_secret_private"), false);
    return true;
  });
});
test("partial Supabase configuration fails instead of silently falling back", () => {
  assert.throws(
    () => repositoryFor({ SUPABASE_URL: "https://test.supabase.co" }),
    /both/,
  );
  assert.ok(
    repositoryFor({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVER_SECRET: "sb_secret_test",
    }) instanceof SupabaseRepository,
  );
  assert.equal(
    storageStatus({
      SUPABASE_URL: "https://test.supabase.co",
      SUPABASE_SERVER_SECRET: "sb_secret_test",
    }).provider,
    "supabase",
  );
});
