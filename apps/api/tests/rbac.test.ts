import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
const client =
  (repo: MemoryRepository, id: string, email: string, workspace?: string) =>
  async (path: string, method = "GET", body?: unknown) => {
    const response = await handleRequest(
      new Request("https://ring.test/api/" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": id,
          "oai-authenticated-user-email": email,
          "Content-Type": "application/json",
          ...(workspace ? { "x-ring-orden-workspace": workspace } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { TRUST_SITES_HEADERS: "true" },
      repo,
    );
    return {
      status: response.status,
      data: (await response.json()) as any,
      headers: response.headers,
    };
  };
async function invite(
  repo: MemoryRepository,
  role: "STAFF" | "MANAGER",
  email: string,
) {
  const owner = client(repo, "owner", "owner@example.com");
  const boot = (await owner("bootstrap")).data;
  const result = await owner("team", "POST", {
    name: role + " User",
    email,
    role,
  });
  assert.equal(result.status, 200);
  const token = new URL(result.data.invite_url).searchParams.get("invite");
  assert.ok(token);
  return { owner, merchant: boot.merchant, token };
}
test("invitation creates membership only for matching verified identity and is single-use", async () => {
  const repo = new MemoryRepository();
  const { merchant, token } = await invite(repo, "STAFF", "staff@example.com");
  const stranger = client(repo, "stranger", "stranger@example.com");
  assert.equal((await stranger("team/accept", "POST", { token })).status, 403);
  const recipient = client(repo, "staff", "staff@example.com");
  const accepted = await recipient("team/accept", "POST", { token });
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  assert.equal(accepted.data.role, "STAFF");
  assert.match(accepted.headers.get("Set-Cookie") ?? "", /ring_workspace=/);
  assert.equal((await recipient("team/accept", "POST", { token })).status, 403);
  const member = client(repo, "staff", "staff@example.com", merchant.id);
  assert.equal((await member("bootstrap")).data.user.role, "STAFF");
});
test("staff sees active orders and basic calls only and cannot read configuration or mutate catalog", async () => {
  const repo = new MemoryRepository();
  const { merchant, token } = await invite(repo, "STAFF", "staff@example.com");
  await client(repo, "staff", "staff@example.com")("team/accept", "POST", {
    token,
  });
  const staff = client(repo, "staff", "staff@example.com", merchant.id);
  const boot = (await staff("bootstrap")).data;
  assert.deepEqual(boot.settings, {});
  assert.deepEqual(boot.team, []);
  assert.deepEqual(boot.memories, []);
  assert.deepEqual(boot.events, []);
  assert.deepEqual(boot.catalog, []);
  assert.ok(
    boot.orders.every(
      (o: any) => !["DRAFT", "COMPLETED", "CANCELLED"].includes(o.status),
    ),
  );
  assert.ok(boot.orders.every((o: any) => o.customer.phone === null));
  assert.ok(boot.calls.every((c: any) => !("turns" in c)));
  assert.equal(
    (
      await staff("settings", "PATCH", {
        section: "business",
        values: { name: "Pwned" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await staff("menu/latte", "PATCH", { available: false })).status,
    403,
  );
  assert.equal(
    (
      await staff("team", "POST", {
        name: "Bad",
        email: "bad@example.com",
        role: "MANAGER",
      })
    ).status,
    403,
  );
  assert.equal((await staff("sessions", "POST", {})).status, 403);
  assert.equal((await staff("orders/order_1044")).status, 403);
});
test("manager can change availability and approve memory but cannot change price, model, team or payment", async () => {
  const repo = new MemoryRepository();
  const { merchant, token } = await invite(
    repo,
    "MANAGER",
    "manager@example.com",
  );
  await client(repo, "manager", "manager@example.com")("team/accept", "POST", {
    token,
  });
  const manager = client(repo, "manager", "manager@example.com", merchant.id);
  const boot = (await manager("bootstrap")).data;
  assert.equal(boot.user.role, "MANAGER");
  assert.deepEqual(boot.settings, {});
  assert.deepEqual(boot.team, []);
  assert.equal(
    (await manager("menu/latte", "PATCH", { available: false })).status,
    200,
  );
  assert.equal(
    (
      await manager(`memories/${boot.memories[0].id}`, "PATCH", {
        action: "approve",
      })
    ).status,
    200,
  );
  assert.equal(
    (await manager("menu/latte", "PATCH", { price: 1 })).status,
    403,
  );
  assert.equal(
    (
      await manager("settings", "PATCH", {
        section: "model",
        values: { api_key: "secret" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await manager("orders/order_1048/action", "POST", { action: "demo_pay" }))
      .status,
    403,
  );
  assert.equal(
    (
      await manager("team", "POST", {
        name: "Bad",
        email: "bad@example.com",
        role: "STAFF",
      })
    ).status,
    403,
  );
});
test("workspace hint never grants membership and expired invitations cannot be accepted", async () => {
  const repo = new MemoryRepository();
  const { merchant, token } = await invite(repo, "STAFF", "staff@example.com");
  const outsider = client(
    repo,
    "outsider",
    "outsider@example.com",
    merchant.id,
  );
  assert.equal((await outsider("bootstrap")).status, 403);
  for (const entry of repo.invitations.values())
    entry.expires_at = new Date(Date.now() - 1000).toISOString();
  assert.equal(
    (
      await client(repo, "staff", "staff@example.com")("team/accept", "POST", {
        token,
      })
    ).status,
    403,
  );
});
test("global voice agent cannot be minted for a foreign merchant", async () => {
  const repo = new MemoryRepository();
  const request = new Request("https://ring.test/api/voice/signed-url", {
    method: "POST",
    headers: {
      "oai-authenticated-user-id": "other",
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  const response = await handleRequest(
    request,
    {
      TRUST_SITES_HEADERS: "true",
      AGENT_MERCHANT_ID: "merchant_a",
      ELEVENLABS_API_KEY: "secret",
      ELEVENLABS_AGENT_ID: "agent_a",
    },
    repo,
  );
  assert.equal(response.status, 403);
});
test("role-filtered bootstrap and direct reads never leak payment links or inactive transcripts", async () => {
  const repo = new MemoryRepository();
  const { merchant, token } = await invite(repo, "STAFF", "staff@example.com");
  await client(repo, "staff", "staff@example.com")("team/accept", "POST", {
    token,
  });
  const owner = client(repo, "owner", "owner@example.com");
  const snapshot = await repo.loadByMerchant(merchant.id);
  assert.ok(snapshot);
  snapshot.state.order_metadata["order_1048"].checkout_id = "cs_secret_link";
  snapshot.state.order_metadata["order_1048"].checkout_url =
    "https://checkout.stripe.com/private-checkout";
  await repo.saveTrusted(merchant.id, snapshot.revision, snapshot.state);
  const staff = client(repo, "staff", "staff@example.com", merchant.id);
  const boot = (await staff("bootstrap")).data;
  assert.equal(JSON.stringify(boot).includes("private-checkout"), false);
  assert.equal(JSON.stringify(boot).includes("cs_secret_link"), false);
  assert.equal(JSON.stringify(boot).includes("+52555550"), false);
  const direct = (await staff("orders/order_1048")).data;
  assert.equal(direct.checkout_url, undefined);
  assert.equal(direct.customer.phone, null);
  assert.equal((await staff("sessions/session_demo_1044")).status, 403);
  assert.equal(
    (await staff("sessions/session_demo_1048")).data.turns,
    undefined,
  );
});
