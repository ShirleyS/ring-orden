import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
const makeClient =
  (repo: MemoryRepository, user = "alice", env: Record<string, unknown> = {}) =>
  async (path: string, method = "GET", body?: unknown) => {
    const response = await handleRequest(
      new Request("https://ring.test/api/" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": user,
          "Content-Type": "application/json",
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
      { TRUST_SITES_HEADERS: "true", ...env },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
test("complete difficult call persists changes, asks clarification, confirms, pays, fulfills", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const boot = await client("bootstrap");
  assert.equal(boot.status, 200);
  assert.equal(boot.data.mode, "demo");
  assert.equal(boot.data.orders.length, 14);
  const created = await client("sessions", "POST", { name: "Test caller" });
  assert.equal(created.status, 201);
  const session = created.data.id;
  const turn = async (utterance: string) =>
    client(`sessions/${session}/turn`, "POST", {
      utterance,
      request_id: crypto.randomUUID(),
    });
  let result = await turn(
    "I want two iced lattes, both oat, and a chocolate croissant.",
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.order.items.length, 3);
  assert.equal(result.data.order.total, 255);
  result = await turn("Actually make the second latte regular milk.");
  assert.equal(result.status, 200);
  assert.equal(result.data.order.total, 243);
  result = await turn("Make the first one decaf.");
  assert.equal(result.status, 200);
  result = await turn("And add an extra shot.");
  assert.equal(result.status, 200);
  assert.equal(result.data.order.status, "AWAITING_CLARIFICATION");
  assert.match(result.data.reply, /which/i);
  result = await turn("The first.");
  assert.equal(result.status, 200);
  assert.equal(result.data.order.total, 258);
  result = await turn("Yes, confirm my order.");
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.equal(result.data.order.status, "PAYMENT_PENDING");
  const id = result.data.order.id;
  result = await client(`orders/${id}/action`, "POST", { action: "demo_pay" });
  assert.equal(result.status, 200);
  assert.equal(result.data.order.payment_status, "PAID");
  for (const action of ["prepare", "ready", "complete"]) {
    result = await client(`orders/${id}/action`, "POST", { action });
    assert.equal(result.status, 200, JSON.stringify(result.data));
  }
  assert.equal(result.data.order.status, "COMPLETED");
  const resumed = await client(`sessions/${session}`);
  assert.equal(resumed.data.order.status, "COMPLETED");
  assert.equal(resumed.data.turns.length, 13);
});
test("repeated turn request applies only once; reused ID with different body fails", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const session = (await client("sessions", "POST", {})).data.id;
  const body = { utterance: "One latte", request_id: "unique-1" };
  const a = await client(`sessions/${session}/turn`, "POST", body);
  const b = await client(`sessions/${session}/turn`, "POST", body);
  assert.equal(a.status, 200);
  assert.deepEqual(a.data, b.data);
  assert.equal(b.data.order.items.length, 1);
  const c = await client(`sessions/${session}/turn`, "POST", {
    ...body,
    utterance: "Two lattes",
  });
  assert.equal(c.status, 409);
});
test("foreign tenant cannot read, pay, alter menu or mutate another session", async () => {
  const repo = new MemoryRepository();
  const alice = makeClient(repo, "alice");
  const bob = makeClient(repo, "bob");
  const created = (await alice("sessions", "POST", {})).data;
  assert.equal((await bob(`orders/${created.order.id}`)).status, 404);
  assert.equal(
    (
      await bob(`orders/${created.order.id}/action`, "POST", {
        action: "demo_pay",
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await bob(`sessions/${created.id}/turn`, "POST", {
        utterance: "One latte",
      })
    ).status,
    404,
  );
  const a = (await alice("bootstrap")).data;
  const b = (await bob("bootstrap")).data;
  assert.notEqual(a.merchant.id, b.merchant.id);
  assert.ok(b.memories.every((m: any) => m.merchant_id === b.merchant.id));
});
test("API never returns saved model or webhook secrets", async () => {
  const client = makeClient(new MemoryRepository());
  await client("settings", "PATCH", {
    section: "model",
    values: { api_key: "private_key_123" },
  });
  await client("settings", "PATCH", {
    section: "pos",
    values: { secret: "webhook-private" },
  });
  const boot = (await client("bootstrap")).data;
  const serialized = JSON.stringify(boot);
  assert.equal(serialized.includes("private_key_123"), false);
  assert.equal(serialized.includes("webhook-private"), false);
  assert.equal(boot.settings.model.has_api_key, true);
});
test("live mode cannot simulate payment", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo, "alice", { DEMO_MODE: "false" });
  const configured = await client("settings", "PATCH", {
    section: "agent",
    values: { after_hours: "accept_orders" },
  });
  assert.equal(configured.status, 200, JSON.stringify(configured.data));
  const created = await client("orders", "POST", {
    items: [{ catalog_item_id: "latte" }],
  });
  assert.equal(created.status, 201, JSON.stringify(created.data));
  const order = created.data;
  assert.equal(
    (await client(`orders/${order.id}/action`, "POST", { action: "demo_pay" }))
      .status,
    403,
  );
});
test("confirmation requires literal consent and invalid preparation is rejected", async () => {
  const client = makeClient(new MemoryRepository());
  const order = (
    await client("orders", "POST", { items: [{ catalog_item_id: "latte" }] })
  ).data;
  assert.equal(
    (await client(`orders/${order.id}/action`, "POST", { action: "confirm" }))
      .status,
    422,
  );
  assert.equal(
    (await client(`orders/${order.id}/action`, "POST", { action: "prepare" }))
      .status,
    400,
  );
  assert.equal(
    (
      await client(`orders/${order.id}/action`, "POST", {
        action: "confirm",
        confirmed: true,
      })
    ).status,
    200,
  );
});
test("payment success URL query alone cannot mark paid", async () => {
  const client = makeClient(new MemoryRepository());
  const order = (
    await client("orders", "POST", { items: [{ catalog_item_id: "latte" }] })
  ).data;
  const result = await client(`orders/${order.id}?payment=success`);
  assert.equal(result.data.payment_status, "PENDING");
});
test("optimistic persistence prevents overwriting concurrent updates", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const boot = (await client("bootstrap")).data;
  const row = await repo.loadByMerchant(boot.merchant.id);
  assert.ok(row);
  const one = structuredClone(row.state);
  one.merchant.name = "First";
  const owner = repo.rows.get(boot.merchant.id)!.owner;
  assert.equal(
    await repo.save(boot.merchant.id, owner, row.revision, one),
    true,
  );
  const stale = structuredClone(row.state);
  stale.merchant.name = "Lost update";
  assert.equal(
    await repo.save(boot.merchant.id, owner, row.revision, stale),
    false,
  );
  assert.equal(
    (await repo.loadByMerchant(boot.merchant.id))!.state.merchant.name,
    "First",
  );
});
test("configured model repairs become memory only after customer confirms", async () => {
  const original = globalThis.fetch;
  let turnIndex = 0;
  let lineId = "";
  globalThis.fetch = async (input, init) => {
    const request = JSON.parse(String(init?.body));
    const data = JSON.parse(
      request.messages.findLast((m: any) => m.role === "user").content,
    );
    lineId = data.order?.items?.[0]?.line_id ?? lineId;
    const operations =
      turnIndex++ === 0
        ? [
            {
              action: "add_item",
              catalog_item_id: "latte",
              modifier_ids: ["almond_milk"],
            },
          ]
        : turnIndex === 2
          ? [
              {
                action: "add_modifier",
                target: { line_id: lineId },
                modifier_id: "oat_milk",
              },
            ]
          : [{ action: "confirm_order", confirmed: true }];
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({ operations, reply: "Updated." }),
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const client = makeClient(new MemoryRepository(), "live-user", {
      DEMO_MODE: "false",
      DEEPSEEK_API_KEY: "test-only-credential",
    });
    const configured = await client("settings", "PATCH", {
      section: "agent",
      values: { after_hours: "accept_orders" },
    });
    assert.equal(configured.status, 200, JSON.stringify(configured.data));
    const created = await client("sessions", "POST", {});
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const session = created.data.id;
    let result = await client(`sessions/${session}/turn`, "POST", {
      utterance: "Un late con abena",
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    result = await client(`sessions/${session}/turn`, "POST", {
      utterance: "No, avena",
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal((await client("bootstrap")).data.memories.length, 0);
    result = await client(`sessions/${session}/turn`, "POST", {
      utterance: "Confirm my order",
    });
    assert.equal(result.status, 200, JSON.stringify(result.data));
    const memory = (await client("bootstrap")).data.memories;
    assert.equal(memory.length, 1);
    assert.equal(memory[0].corrected_interpretation.modifier, "oat_milk");
    assert.equal(memory[0].observed_text, "un late con abena");
  } finally {
    globalThis.fetch = original;
  }
});
test("confirmed unpaid draft can be changed and requires reconfirmation with new price", async () => {
  const client = makeClient(new MemoryRepository());
  const session = (await client("sessions", "POST", {})).data.id;
  for (const utterance of ["One latte", "Confirm my order"])
    assert.equal(
      (await client(`sessions/${session}/turn`, "POST", { utterance })).status,
      200,
    );
  const changed = await client(`sessions/${session}/turn`, "POST", {
    utterance: "Add a croissant",
  });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.order.status, "DRAFT");
  assert.equal(changed.data.order.total, 139);
  const confirmed = await client(`sessions/${session}/turn`, "POST", {
    utterance: "Confirm my order",
  });
  assert.equal(confirmed.data.order.status, "PAYMENT_PENDING");
  assert.equal(confirmed.data.order.total, 139);
});
test("paid session cannot be modified even by an ordinary new-item turn", async () => {
  const client = makeClient(new MemoryRepository());
  const session = (await client("sessions", "POST", {})).data.id;
  for (const utterance of ["One latte", "Confirm my order"])
    await client(`sessions/${session}/turn`, "POST", { utterance });
  const sessionState = (await client(`sessions/${session}`)).data;
  await client(`orders/${sessionState.order.id}/action`, "POST", {
    action: "demo_pay",
  });
  assert.equal(
    (
      await client(`sessions/${session}/turn`, "POST", {
        utterance: "Add a croissant",
      })
    ).status,
    409,
  );
});
test("live ordering respects a fully closed merchant schedule", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                operations: [{ action: "add_item", catalog_item_id: "latte" }],
                reply: "Added.",
              }),
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  try {
    const client = makeClient(new MemoryRepository(), "closed-user", {
      DEMO_MODE: "false",
      DEEPSEEK_API_KEY: "test-only",
    });
    const schedule = Object.fromEntries(
      ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
        day,
        { enabled: false, open: "07:00", close: "20:00" },
      ]),
    );
    assert.equal(
      (
        await client("settings", "PATCH", {
          section: "business",
          values: { schedule },
        })
      ).status,
      200,
    );
    const session = (await client("sessions", "POST", {})).data.id;
    const turn = await client(`sessions/${session}/turn`, "POST", {
      utterance: "One latte",
    });
    assert.equal(turn.status, 200);
    assert.equal(turn.data.order.items.length, 0);
    assert.equal(turn.data.order.status, "AWAITING_CLARIFICATION");
    assert.match(turn.data.reply, /closed/i);
  } finally {
    globalThis.fetch = original;
  }
});
test("editing unpaid order expires the previous Stripe checkout before changing amount", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const session = (await client("sessions", "POST", {})).data.id;
  for (const utterance of ["One latte", "Confirm my order"])
    await client(`sessions/${session}/turn`, "POST", { utterance });
  const boot = (await client("bootstrap")).data;
  const stored = await repo.loadByMerchant(boot.merchant.id);
  assert.ok(stored);
  const order = stored.state.orders.find(
    (o) => o.id === stored.state.sessions[0].order_id,
  )!;
  stored.state.order_metadata[order.id].checkout_id = "cs_test_old";
  stored.state.order_metadata[order.id].checkout_url =
    "https://checkout.stripe.com/test-old";
  await repo.saveTrusted(boot.merchant.id, stored.revision, stored.state);
  const original = globalThis.fetch;
  const requested: string[] = [];
  globalThis.fetch = async (input) => {
    requested.push(String(input));
    return new Response(JSON.stringify({ status: "expired" }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const stripeClient = makeClient(repo, "alice", {
      STRIPE_SECRET_KEY: "sk_test_stub",
    });
    const changed = await stripeClient(`sessions/${session}/turn`, "POST", {
      utterance: "Add a croissant",
    });
    assert.equal(changed.status, 200, JSON.stringify(changed.data));
    assert.equal(changed.data.order.total, 139);
    assert.equal(changed.data.order.checkout_url, undefined);
    assert.ok(requested.some((url) => url.endsWith("/cs_test_old/expire")));
  } finally {
    globalThis.fetch = original;
  }
});
test("agent tool service is bound to configured merchant and deduplicates session creation", async () => {
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const boot = (await client("bootstrap")).data;
  const call = async (secret: string, body: unknown) => {
    const response = await handleRequest(
      new Request("https://ring.test/api/tools/create_session", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + secret,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
      {
        AGENT_TOOL_SECRET: "trusted-secret",
        AGENT_MERCHANT_ID: boot.merchant.id,
      },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
  assert.equal((await call("wrong-secret", {})).status, 401);
  const first = await call("trusted-secret", {
    request_id: "agent-call-1",
    merchant_id: "attacker",
  });
  const again = await call("trusted-secret", {
    request_id: "agent-call-1",
    merchant_id: "attacker",
  });
  assert.equal(first.status, 201);
  assert.equal(first.data.order.merchant_id, boot.merchant.id);
  assert.equal(first.data.session_id, again.data.session_id);
});
test("order persists and delivery is claimed before Stripe call; confirming twice has one provider write", async () => {
  const repo = new MemoryRepository();
  const original = globalThis.fetch;
  let checkoutCalls = 0;
  const client = makeClient(repo, "outbox-user", {
    STRIPE_SECRET_KEY: "sk_test_stub",
  });
  let merchantId = "",
    orderId = "";
  globalThis.fetch = async () => {
    checkoutCalls++;
    const stored = await repo.loadByMerchant(merchantId);
    assert.ok(stored);
    const saved = stored.state.orders.find((o) => o.id === orderId)!;
    assert.equal(saved.status, "PAYMENT_PENDING");
    assert.equal(
      stored.state.order_metadata[orderId].delivery_status,
      "PROCESSING",
    );
    return new Response(
      JSON.stringify({
        id: "cs_test_saved",
        url: "https://checkout.stripe.com/saved",
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    merchantId = (await client("bootstrap")).data.merchant.id;
    const created = (
      await client("orders", "POST", { items: [{ catalog_item_id: "latte" }] })
    ).data;
    orderId = created.id;
    const first = await client(`orders/${orderId}/action`, "POST", {
      action: "confirm",
      confirmed: true,
    });
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.order.checkout_id, "cs_test_saved");
    assert.equal(
      (
        await client(`orders/${orderId}/action`, "POST", {
          action: "confirm",
          confirmed: true,
        })
      ).status,
      200,
    );
    assert.equal(checkoutCalls, 1);
  } finally {
    globalThis.fetch = original;
  }
});
test("signed Stripe webhook checks saved checkout and amount, updates paid, and ignores duplicate event", async () => {
  const { hmacHex } = await import("../src/payments.ts");
  const repo = new MemoryRepository();
  const client = makeClient(repo);
  const order = (
    await client("orders", "POST", { items: [{ catalog_item_id: "latte" }] })
  ).data;
  await client(`orders/${order.id}/action`, "POST", {
    action: "confirm",
    confirmed: true,
  });
  const boot = (await client("bootstrap")).data;
  const stored = await repo.loadByMerchant(boot.merchant.id);
  assert.ok(stored);
  stored.state.order_metadata[order.id].checkout_id = "cs_test_valid";
  await repo.saveTrusted(boot.merchant.id, stored.revision, stored.state);
  const send = async (amount: number, id: string) => {
    const body = JSON.stringify({
      id,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_valid",
          metadata: { merchant_id: boot.merchant.id, order_id: order.id },
          payment_status: "paid",
          amount_total: amount,
          currency: "mxn",
        },
      },
    });
    const stamp = Math.floor(Date.now() / 1000);
    const signature = await hmacHex("webhook-test-secret", `${stamp}.${body}`);
    return handleRequest(
      new Request("https://ring.test/api/webhooks/stripe", {
        method: "POST",
        headers: { "Stripe-Signature": `t=${stamp},v1=${signature}` },
        body,
      }),
      { STRIPE_WEBHOOK_SECRET: "webhook-test-secret" },
      repo,
    );
  };
  assert.equal((await send(1, "evt_wrong_amount")).status, 400);
  assert.equal(
    (await client(`orders/${order.id}`)).data.payment_status,
    "PENDING",
  );
  assert.equal((await send(7400, "evt_success")).status, 200);
  assert.equal(
    (await client(`orders/${order.id}`)).data.payment_status,
    "PAID",
  );
  const repeated = await send(7400, "evt_success");
  assert.equal(repeated.status, 200);
  assert.equal(((await repeated.json()) as any).duplicate, true);
});
test("closed live merchant accepts only future pickup within scheduled opening hours", async () => {
  const client = makeClient(new MemoryRepository(), "schedule-user", {
    DEMO_MODE: "false",
  });
  const tomorrow = new Date(Date.now() + 86400000);
  tomorrow.setUTCHours(10, 0, 0, 0);
  const day = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][
    tomorrow.getUTCDay()
  ];
  const schedule = Object.fromEntries(
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((d) => [
      d,
      { enabled: d === day, open: "09:00", close: "17:00" },
    ]),
  );
  assert.equal(
    (
      await client("settings", "PATCH", {
        section: "business",
        values: { timezone: "UTC", schedule },
      })
    ).status,
    200,
  );
  await client("settings", "PATCH", {
    section: "agent",
    values: { after_hours: "scheduled_orders" },
  });
  const immediate = await client("orders", "POST", {
    items: [{ catalog_item_id: "latte" }],
  });
  assert.equal(immediate.status, 409);
  const scheduled = await client("orders", "POST", {
    items: [{ catalog_item_id: "latte" }],
    fulfillment: { type: "pickup", scheduled_for: tomorrow.toISOString() },
  });
  assert.equal(scheduled.status, 201, JSON.stringify(scheduled.data));
  const confirmed = await client(`orders/${scheduled.data.id}/action`, "POST", {
    action: "confirm",
    confirmed: true,
  });
  assert.equal(confirmed.status, 200, JSON.stringify(confirmed.data));
  const closedPickup = new Date(tomorrow);
  closedPickup.setUTCHours(21);
  assert.equal(
    (
      await client("orders", "POST", {
        items: [{ catalog_item_id: "latte" }],
        fulfillment: {
          type: "pickup",
          scheduled_for: closedPickup.toISOString(),
        },
      })
    ).status,
    409,
  );
});
test("settings forbid minimum order above maximum and synchronize primary language", async () => {
  const client = makeClient(new MemoryRepository());
  assert.equal(
    (
      await client("settings", "PATCH", {
        section: "business",
        values: { minimum_order: 6000, maximum_order: 5000 },
      })
    ).status,
    422,
  );
  assert.equal(
    (
      await client("settings", "PATCH", {
        section: "business",
        values: { language: "en-US" },
      })
    ).status,
    200,
  );
  assert.equal((await client("bootstrap")).data.merchant.language, "en-US");
});
test("owner can edit modifier price and availability; confirmation rechecks sold-out modifiers", async () => {
  const client = makeClient(new MemoryRepository());
  const boot = (await client("bootstrap")).data;
  const latte = boot.catalog.find((item: any) => item.id === "latte");
  let modifiers = latte.modifiers.map((m: any) =>
    m.id === "oat_milk" ? { ...m, price_delta: 15 } : m,
  );
  assert.equal(
    (
      await client("menu/latte", "PATCH", {
        name: latte.name,
        price: latte.price,
        description: latte.description,
        category: latte.category,
        available: latte.available,
        modifiers,
      })
    ).status,
    200,
  );
  const order = (
    await client("orders", "POST", {
      items: [{ catalog_item_id: "latte", modifier_ids: ["oat_milk"] }],
    })
  ).data;
  assert.equal(order.total, 89);
  modifiers = modifiers.map((m: any) =>
    m.id === "oat_milk" ? { ...m, available: false } : m,
  );
  assert.equal(
    (await client("menu/latte", "PATCH", { modifiers })).status,
    200,
  );
  const confirmation = await client(`orders/${order.id}/action`, "POST", {
    action: "confirm",
    confirmed: true,
  });
  assert.equal(confirmation.status, 400);
  assert.match(confirmation.data.error, /unavailable/i);
});
