import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import { tenantIdFor } from "../src/auth.ts";

const env = {
  TRUST_SITES_HEADERS: "true",
  CUSTOMER_APP_ORIGIN: "https://order.example",
};
async function call(
  repo: MemoryRepository,
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
  settings = env,
) {
  const response = await handleRequest(
    new Request(`https://ring.test/api/${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
    settings,
    repo,
  );
  return {
    response,
    status: response.status,
    data: response.status === 204 ? null : ((await response.json()) as any),
  };
}
async function setup() {
  const repo = new MemoryRepository();
  const owner = (path: string, method = "GET", body?: unknown) =>
    call(repo, path, method, body, { "oai-authenticated-user-id": "alice" });
  const created = await owner("orders", "POST", {
    customer: { name: "Ana", phone: "+525555550123" },
    items: [{ catalog_item_id: "latte" }],
  });
  const order = created.data;
  const link = await owner(`orders/${order.id}/customer-link`, "POST");
  const token = link.data.url
    ? new URL(link.data.url).hash.slice(1)
    : "missing-feature";
  const guest = (
    path = "order",
    method = "GET",
    body?: unknown,
    extra: Record<string, string> = {},
  ) =>
    call(repo, `customer/${path}`, method, body, {
      Authorization: `Bearer ${token}`,
      Origin: "https://order.example",
      ...extra,
    });
  return {
    repo,
    owner,
    order,
    link,
    token,
    guest,
    merchantId: order.merchant_id,
  };
}

test("owner issues a fragment-only link and guest sees only this order's safe fields", async () => {
  const f = await setup();
  assert.equal(f.link.status, 201);
  const url = new URL(f.link.data.url);
  assert.equal(url.origin, "https://order.example");
  assert.equal(url.pathname, "/order");
  assert.equal(url.search, "");
  assert.ok(url.hash.length > 80);
  assert.ok(Date.parse(f.link.data.expires_at) > Date.now() + 59 * 60_000);
  const result = await f.guest();
  assert.equal(result.status, 200);
  assert.equal(result.data.order.reference, f.order.external_reference);
  assert.equal(result.data.order.total, 74);
  assert.equal(result.data.editable, true);
  assert.equal(result.data.merchant.name, "Café Oliva");
  for (const privateText of [
    "+525555550123",
    "notification_phone",
    "checkout_id",
    "customer_link",
    '"memories"',
    '"sessions"',
    '"team"',
    "api_key",
    "merchant_id",
  ])
    assert.equal(
      JSON.stringify(result.data).includes(privateText),
      false,
      privateText,
    );
  const row = await f.repo.loadByMerchant(f.merchantId);
  assert.equal(
    JSON.stringify(row).includes(f.token),
    false,
    "raw token must not be persisted",
  );
  assert.equal(result.response.headers.get("Cache-Control"), "no-store");
  assert.equal(result.response.headers.get("Referrer-Policy"), "no-referrer");
});

test("missing, query-only, malformed and forged tokens cannot read orders", async () => {
  const f = await setup();
  for (const authorization of [
    "",
    "Bearer nonsense",
    `Bearer ${f.token.slice(0, -4)}aaaa`,
  ]) {
    assert.equal(
      (
        await call(f.repo, "customer/order", "GET", undefined, {
          Authorization: authorization,
        })
      ).status,
      401,
    );
  }
  assert.equal(
    (await call(f.repo, `customer/order?token=${f.token}`)).status,
    401,
  );
  const payload = JSON.parse(Buffer.from(f.token, "base64url").toString());
  payload.order_id = "order_other";
  const forged = Buffer.from(JSON.stringify(payload)).toString("base64url");
  assert.equal(
    (
      await call(f.repo, "customer/order", "GET", undefined, {
        Authorization: `Bearer ${forged}`,
      })
    ).status,
    401,
  );
  payload.merchant_id = await tenantIdFor("bob");
  assert.equal(
    (
      await call(f.repo, "customer/order", "GET", undefined, {
        Authorization: `Bearer ${Buffer.from(JSON.stringify(payload)).toString("base64url")}`,
      })
    ).status,
    401,
  );
});

test("regenerating, revoking and expiring a link invalidates the old grant", async () => {
  const f = await setup();
  const newLink = await f.owner(`orders/${f.order.id}/customer-link`, "POST");
  assert.equal(newLink.status, 201);
  assert.notEqual(newLink.data.url, f.link.data.url);
  assert.equal((await f.guest()).status, 401);
  const headers = {
    Authorization: `Bearer ${new URL(newLink.data.url).hash.slice(1)}`,
  };
  assert.equal(
    (await call(f.repo, "customer/order", "GET", undefined, headers)).status,
    200,
  );
  const row = (await f.repo.loadByMerchant(f.merchantId))!;
  (row.state.order_metadata[f.order.id] as any).customer_link.expires_at =
    new Date(Date.now() - 1).toISOString();
  await f.repo.saveTrusted(f.merchantId, row.revision, row.state);
  assert.equal(
    (await call(f.repo, "customer/order", "GET", undefined, headers)).status,
    401,
  );
  const latest = await f.owner(`orders/${f.order.id}/customer-link`, "POST");
  assert.equal(
    (await f.owner(`orders/${f.order.id}/customer-link`, "DELETE")).status,
    200,
  );
  assert.equal(
    (
      await call(f.repo, "customer/order", "GET", undefined, {
        Authorization: `Bearer ${new URL(latest.data.url).hash.slice(1)}`,
      })
    ).status,
    401,
  );
});

test("only owner or bound voice tool can issue links, and other tenants cannot", async () => {
  const f = await setup();
  f.repo.members.push({
    merchant_id: f.merchantId,
    subject: "sites:manager",
    role: "MANAGER",
    name: "Manager",
    email: "manager@example.test",
  });
  assert.equal(
    (
      await call(
        f.repo,
        `orders/${f.order.id}/customer-link`,
        "POST",
        {},
        { "oai-authenticated-user-id": "manager" },
      )
    ).status,
    403,
  );
  const managerOrder = await call(
    f.repo,
    `orders/${f.order.id}`,
    "GET",
    undefined,
    { "oai-authenticated-user-id": "manager" },
  );
  assert.equal(managerOrder.data.customer_link, undefined);
  assert.equal(
    (
      await call(
        f.repo,
        `orders/${f.order.id}/customer-link`,
        "POST",
        {},
        { "oai-authenticated-user-id": "bob" },
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.repo,
        `orders/${f.order.id}/customer-link`,
        "POST",
        {},
        { Authorization: `Bearer ${f.token}` },
      )
    ).status,
    401,
  );
  const voiceEnv = {
    ...env,
    AGENT_TOOL_SECRET: "voice-secret",
    AGENT_MERCHANT_ID: f.merchantId,
  };
  const session = await call(
    f.repo,
    "tools/create_session",
    "POST",
    {},
    { Authorization: "Bearer voice-secret" },
    voiceEnv,
  );
  const link = await call(
    f.repo,
    "tools/customer_link",
    "POST",
    { session_id: session.data.id },
    { Authorization: "Bearer voice-secret" },
    voiceEnv,
  );
  assert.equal(link.status, 201);
  assert.match(link.data.url, /^https:\/\/order\.example\/order#/);
});

test("customer CORS permits only the exact configured origin without cookies", async () => {
  const f = await setup();
  const good = await f.guest("order", "OPTIONS", undefined, {
    "Access-Control-Request-Method": "PATCH",
    "Access-Control-Request-Headers": "authorization,content-type",
  });
  assert.equal(good.status, 204);
  assert.equal(
    good.response.headers.get("Access-Control-Allow-Origin"),
    "https://order.example",
  );
  assert.equal(
    good.response.headers.get("Access-Control-Allow-Credentials"),
    null,
  );
  const bad = await f.guest(
    "order",
    "PATCH",
    { revision: f.order.revision, operations: [] },
    { Origin: "https://evil.test" },
  );
  assert.equal(bad.status, 403);
  assert.equal(bad.response.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal((await f.guest("not-a-route", "OPTIONS")).status, 404);
});

test("draft edits use catalog prices and return the latest revision", async () => {
  const f = await setup();
  const edited = await f.guest("order", "PATCH", {
    revision: f.order.revision,
    operations: [
      { action: "add_item", catalog_item_id: "croissant" },
      {
        action: "add_modifier",
        target: { line_id: f.order.items[0].line_id },
        modifier_id: "oat_milk",
      },
    ],
  });
  assert.equal(edited.status, 200, JSON.stringify(edited.data));
  assert.equal(edited.data.order.total, 151);
  assert.equal(edited.data.order.items.length, 2);
  assert.ok(edited.data.order.revision > f.order.revision);
  const tampered = await f.guest("order", "PATCH", {
    revision: edited.data.order.revision,
    operations: [{ action: "add_item", catalog_item_id: "latte", price: 0 }],
  });
  assert.equal(tampered.status, 422);
  assert.equal((await f.guest()).data.order.total, 151);
});

test("stale edits and customer attempts to change status or tenant are rejected", async () => {
  const f = await setup();
  const changed = await f.guest("order", "PATCH", {
    revision: f.order.revision,
    operations: [{ action: "set_customer_name", name: "Ana María" }],
  });
  assert.equal(changed.status, 200);
  assert.equal(
    (
      await f.guest("order", "PATCH", {
        revision: f.order.revision,
        operations: [
          {
            action: "remove_item",
            target: { line_id: f.order.items[0].line_id },
          },
        ],
      })
    ).status,
    409,
  );
  for (const body of [
    {
      revision: changed.data.order.revision,
      operations: [{ action: "confirm_order", confirmed: true }],
    },
    {
      revision: changed.data.order.revision,
      operations: [],
      merchant_id: "other",
    },
    {
      revision: changed.data.order.revision,
      operations: [],
      payment_status: "PAID",
    },
  ])
    assert.equal((await f.guest("order", "PATCH", body)).status, 422);
});

test("confirmation requires explicit consent and the freshly reviewed total", async () => {
  const f = await setup();
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: f.order.revision,
        reviewed_total: 74,
      })
    ).status,
    422,
  );
  await f.owner("menu/latte", "PATCH", { price: 80 });
  const changed = await f.guest("confirm", "POST", {
    revision: f.order.revision,
    reviewed_total: 74,
    confirmed: true,
  });
  assert.equal(changed.status, 409);
  assert.equal((await f.guest()).data.order.total, 80);
  assert.equal((await f.owner(`orders/${f.order.id}`)).data.status, "DRAFT");
  const confirmed = await f.guest("confirm", "POST", {
    revision: f.order.revision,
    reviewed_total: 80,
    confirmed: true,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  assert.equal(confirmed.data.editable, false);
  assert.equal(confirmed.data.order.status, "PAYMENT_PENDING");
  const repeat = await f.guest("confirm", "POST", {
    revision: f.order.revision,
    reviewed_total: 80,
    confirmed: true,
  });
  assert.equal(repeat.status, 200);
  const row = (await f.repo.loadByMerchant(f.merchantId))!;
  assert.equal(
    row.state.events.filter(
      (e) => e.type === "order.confirmed" && e.order_id === f.order.id,
    ).length,
    1,
  );
  assert.equal(
    (
      await f.guest("order", "PATCH", {
        revision: confirmed.data.order.revision,
        operations: [
          {
            action: "remove_item",
            target: { line_id: f.order.items[0].line_id },
          },
        ],
      })
    ).status,
    409,
  );
});

test("unavailable items, closed ordering and unresolved clarification prevent confirmation", async () => {
  const f = await setup();
  await f.owner("menu/latte", "PATCH", { available: false });
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: f.order.revision,
        reviewed_total: 74,
        confirmed: true,
      })
    ).status,
    409,
  );
  assert.equal((await f.guest()).data.problems.length, 1);
  await f.owner("menu/latte", "PATCH", { available: true });
  const row = (await f.repo.loadByMerchant(f.merchantId))!;
  row.state.settings.agent.enabled = false;
  await f.repo.saveTrusted(f.merchantId, row.revision, row.state);
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: f.order.revision,
        reviewed_total: 74,
        confirmed: true,
      })
    ).status,
    409,
  );
});

test("a simultaneous merchant change wins CAS and customer edit cannot overwrite it", async () => {
  const f = await setup();
  const original = f.repo.saveTrusted.bind(f.repo);
  let race = true;
  f.repo.saveTrusted = async (id, revision, state) => {
    if (race) {
      race = false;
      const latest = (await f.repo.loadByMerchant(id))!;
      latest.state.orders.find((o) => o.id === f.order.id)!.customer.name =
        "Merchant update";
      await original(id, latest.revision, latest.state);
    }
    return original(id, revision, state);
  };
  const result = await f.guest("order", "PATCH", {
    revision: f.order.revision,
    operations: [{ action: "set_customer_name", name: "Customer update" }],
  });
  assert.equal(result.status, 409);
  assert.equal(
    (await f.owner(`orders/${f.order.id}`)).data.customer.name,
    "Merchant update",
  );
});

test("checkout returns only the confirmed order's saved Stripe URL; query success is never payment", async () => {
  const f = await setup();
  assert.equal((await f.guest("checkout", "POST", {})).status, 409);
  await f.guest("confirm", "POST", {
    revision: f.order.revision,
    reviewed_total: 74,
    confirmed: true,
  });
  assert.equal((await f.guest("checkout", "POST", {})).status, 503);
  const row = (await f.repo.loadByMerchant(f.merchantId))!;
  row.state.order_metadata[f.order.id].checkout_url =
    "https://checkout.stripe.com/c/pay/cs_test_customer";
  await f.repo.saveTrusted(f.merchantId, row.revision, row.state);
  const result = await f.guest("checkout", "POST", {});
  assert.equal(result.status, 200);
  assert.equal(
    result.data.checkout_url,
    "https://checkout.stripe.com/c/pay/cs_test_customer",
  );
  const read = await f.guest("order?payment=success");
  assert.equal(read.data.order.payment_status, "PENDING");
  assert.equal(read.data.order.checkout_url, undefined);
});

test("paid orders show confirmation but cannot open checkout or be edited", async () => {
  const f = await setup();
  await f.guest("confirm", "POST", {
    revision: f.order.revision,
    reviewed_total: 74,
    confirmed: true,
  });
  await f.owner(`orders/${f.order.id}/action`, "POST", { action: "demo_pay" });
  assert.equal((await f.guest()).data.order.payment_status, "PAID");
  assert.equal((await f.guest("checkout", "POST", {})).status, 409);
  assert.equal(
    (
      await f.guest("order", "PATCH", {
        revision: f.order.revision,
        operations: [{ action: "set_customer_name", name: "Another" }],
      })
    ).status,
    409,
  );
});

test("customer links require a configured secure frontend origin", async () => {
  const f = await setup();
  for (const CUSTOMER_APP_ORIGIN of [
    "",
    "http://example.test",
    "https://example.test/path",
    "https://example.test?tracking=1",
    "https://user:pass@example.test",
  ]) {
    const result = await call(
      f.repo,
      `orders/${f.order.id}/customer-link`,
      "POST",
      {},
      { "oai-authenticated-user-id": "alice" },
      { ...env, CUSTOMER_APP_ORIGIN },
    );
    assert.equal(result.status, 503);
  }
});

test("issuance with an idempotency key never persists the raw customer credential", async () => {
  const f = await setup();
  const result = await call(
    f.repo,
    `orders/${f.order.id}/customer-link`,
    "POST",
    {},
    {
      "oai-authenticated-user-id": "alice",
      "Idempotency-Key": "customer-link-1",
    },
  );
  assert.equal(result.status, 201);
  const token = new URL(result.data.url).hash.slice(1);
  assert.equal(
    JSON.stringify(await f.repo.loadByMerchant(f.merchantId)).includes(token),
    false,
  );
});

test("changing a name does not silently resolve an outstanding item clarification", async () => {
  const f = await setup();
  const row = (await f.repo.loadByMerchant(f.merchantId))!;
  const order = row.state.orders.find((o) => o.id === f.order.id)!;
  order.status = "AWAITING_CLARIFICATION";
  order.clarification = "Which latte should have oat milk?";
  await f.repo.saveTrusted(f.merchantId, row.revision, row.state);
  const renamed = await f.guest("order", "PATCH", {
    revision: f.order.revision,
    operations: [{ action: "set_customer_name", name: "Ana" }],
  });
  assert.equal(renamed.status, 200);
  assert.equal(
    renamed.data.order.clarification,
    "Which latte should have oat milk?",
  );
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: renamed.data.order.revision,
        reviewed_total: 74,
        confirmed: true,
      })
    ).status,
    409,
  );
  const resolved = await f.guest("order", "PATCH", {
    revision: renamed.data.order.revision,
    operations: [
      {
        action: "add_modifier",
        target: { line_id: f.order.items[0].line_id },
        modifier_id: "oat_milk",
      },
    ],
  });
  assert.equal(resolved.status, 200);
  assert.equal(resolved.data.order.clarification, null);
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: resolved.data.order.revision,
        reviewed_total: 86,
        confirmed: true,
      })
    ).status,
    200,
  );
});

test("revoking a link during slow provider delivery cannot resurrect its old grant", async () => {
  const f = await setup();
  const fetchBefore = globalThis.fetch;
  let reachedProvider!: () => void;
  let finishProvider!: () => void;
  const providerReached = new Promise<void>((resolve) => {
    reachedProvider = resolve;
  });
  const providerReleased = new Promise<void>((resolve) => {
    finishProvider = resolve;
  });
  globalThis.fetch = async () => {
    reachedProvider();
    await providerReleased;
    return Response.json({
      id: "cs_test_revocation",
      url: "https://checkout.stripe.com/c/pay/cs_test_revocation",
    });
  };
  try {
    const paymentEnv = {
      ...env,
      STRIPE_SECRET_KEY: "sk_test_customer_link_fixture",
    };
    const confirmation = call(
      f.repo,
      "customer/confirm",
      "POST",
      { revision: f.order.revision, reviewed_total: 74, confirmed: true },
      { Authorization: `Bearer ${f.token}` },
      paymentEnv,
    );
    await providerReached;
    assert.equal(
      (await f.owner(`orders/${f.order.id}/customer-link`, "DELETE")).status,
      200,
    );
    finishProvider();
    assert.equal((await confirmation).status, 200);
    assert.equal((await f.guest()).status, 401);
  } finally {
    finishProvider();
    globalThis.fetch = fetchBefore;
  }
});

test("a customer can remove all unavailable lines in a single atomic repair", async () => {
  const f = await setup();
  const added = await f.guest("order", "PATCH", {
    revision: f.order.revision,
    operations: [{ action: "add_item", catalog_item_id: "croissant" }],
  });
  assert.equal(added.status, 200);
  await f.owner("menu/latte", "PATCH", { available: false });
  await f.owner("menu/croissant", "PATCH", { available: false });
  const result = await f.guest("order", "PATCH", {
    revision: added.data.order.revision,
    operations: added.data.order.items.map((item: any) => ({
      action: "remove_item",
      target: { line_id: item.line_id },
    })),
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.order.items.length, 0);
  assert.equal(result.data.order.total, 0);
  assert.equal(
    (
      await f.guest("confirm", "POST", {
        revision: result.data.order.revision,
        reviewed_total: 0,
        confirmed: true,
      })
    ).status,
    409,
  );
  const unavailable = await f.guest("order", "PATCH", {
    revision: result.data.order.revision,
    operations: [{ action: "add_item", catalog_item_id: "latte" }],
  });
  assert.equal(unavailable.status, 400);
  assert.equal((await f.guest()).data.order.items.length, 0);
});

test("customer checkout returns to the customer app without disclosing its order token to Stripe", async () => {
  const f = await setup();
  const previousFetch = globalThis.fetch;
  let stripeBody: URLSearchParams | undefined;
  globalThis.fetch = async (_url, init) => {
    stripeBody = new URLSearchParams(String(init?.body));
    return Response.json({
      id: "cs_test_customer_return",
      url: "https://checkout.stripe.com/c/pay/cs_test_customer_return",
    });
  };
  try {
    const paymentEnv = {
      ...env,
      STRIPE_SECRET_KEY: "sk_test_customer_return_fixture",
    };
    const result = await call(
      f.repo,
      "customer/confirm",
      "POST",
      { revision: f.order.revision, reviewed_total: 74, confirmed: true },
      { Authorization: `Bearer ${f.token}` },
      paymentEnv,
    );
    assert.equal(result.status, 200);
    assert.equal(
      stripeBody?.get("success_url"),
      "https://order.example/order?payment=returned",
    );
    assert.equal(
      stripeBody?.get("cancel_url"),
      "https://order.example/order?payment=cancelled",
    );
    assert.equal(stripeBody?.toString().includes(f.token), false);
    assert.equal((await f.guest()).data.order.payment_status, "PENDING");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
