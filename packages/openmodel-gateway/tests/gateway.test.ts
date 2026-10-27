import { test } from "node:test";
import assert from "node:assert/strict";
import {
  interpretDemo,
  OpenAICompatibleAdapter,
  Gateway,
  runCompatibilityTest,
} from "../src/index.ts";
import {
  createOrder,
  applyOperations,
  DEMO_CATALOG,
} from "../../ring-orden-core/src/index.ts";
function turn(order: ReturnType<typeof createOrder>, text: string) {
  const r = interpretDemo(text, order);
  return { result: r, order: applyOperations(order, r.operations) };
}
test("main difficult transaction resolves references and asks ambiguity", () => {
  let o = createOrder("m");
  o = turn(
    o,
    "I want two iced lattes, both oat, and a chocolate croissant.",
  ).order;
  assert.equal(o.items.length, 3);
  assert.equal(o.total, 255);
  o = turn(o, "Actually make the second latte regular milk.").order;
  assert.equal(o.items[1].modifiers.length, 0);
  o = turn(o, "Make the first one decaf.").order;
  assert.ok(o.items[0].modifiers.some((m) => m.modifier_id === "decaf"));
  const r = turn(o, "And add an extra shot.");
  assert.match(r.result.reply, /which/i);
  o = r.order;
  assert.equal(o.status, "AWAITING_CLARIFICATION");
  o = turn(o, "The first.").order;
  assert.ok(o.items[0].modifiers.some((m) => m.modifier_id === "extra_shot"));
  assert.equal(o.total, 258);
  o = turn(o, "Confirm my order").order;
  assert.equal(o.status, "CONFIRMED");
});
for (const [phrase, id, qty] of [
  ["Me regalas dos lattes.", "latte", 2],
  ["Dame two iced lattes, uno oat.", "iced_latte", 2],
  ["Un americano por favor", "americano", 1],
  ["I want a cappuccino", "cappuccino", 1],
  ["Dame un croissant de chocolate", "chocolate_croissant", 1],
  ["An ube croissant please", "ube_croissant", 1],
  ["Un late con avena", "latte", 1],
] as const) {
  test(`demo parses ${phrase}`, () => {
    const r = turn(createOrder("m"), phrase);
    assert.equal(r.order.items[0].catalog_item_id, id);
    assert.equal(r.order.items.length, qty);
  });
}
test("ambiguous milk reference asks one question", () => {
  const o = turn(createOrder("m"), "two lattes").order;
  assert.equal(
    interpretDemo("Make that oat", o).operations[0].action,
    "request_clarification",
  );
});
test("other one targets complement of prior clarified line", () => {
  const o = turn(createOrder("m"), "two lattes").order;
  const r = interpretDemo("the second one decaf", o);
  assert.equal((r.operations[0] as any).target.line_id, o.items[1].line_id);
});
test("remove croissant preserves lattes", () => {
  const o = turn(createOrder("m"), "two lattes and a croissant").order;
  assert.equal(turn(o, "take the croissant off").order.items.length, 2);
});
test("unknown items do not hallucinate", () => {
  const r = interpretDemo("Give me lobster", createOrder("m"));
  assert.equal(r.operations[0].action, "request_clarification");
});
test("support request escalates", () =>
  assert.equal(
    interpretDemo("I want a human", createOrder("m")).operations[0].action,
    "escalate_issue",
  ));
test("model adapter invalid JSON fails closed", async () => {
  const a = new OpenAICompatibleAdapter({
    provider: "generic",
    endpoint: "https://example.com/v1",
    model: "test",
    fetch: async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: "not json" } }] }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () =>
      a.generateStructuredOutput({
        utterance: "latte",
        order: createOrder("m"),
        catalog: DEMO_CATALOG,
      }),
    /JSON/,
  );
});
test("fallback is never used when disabled", async () => {
  let fallback = 0;
  const broken: any = {
    id: "broken",
    generateStructuredOutput: async () => {
      throw Error("unavailable");
    },
  };
  const fb: any = {
    id: "fallback",
    generateStructuredOutput: async () => {
      fallback++;
      return { operations: [], reply: "ok" };
    },
  };
  await assert.rejects(() =>
    new Gateway(broken, { fallback: fb, allowFallback: false }).interpret({
      utterance: "latte",
      order: createOrder("m"),
      catalog: DEMO_CATALOG,
    }),
  );
  assert.equal(fallback, 0);
});
test("fallback use is logged when enabled", async () => {
  const events: any[] = [];
  const broken: any = {
    id: "broken",
    generateStructuredOutput: async () => {
      throw Error("timeout");
    },
  };
  const fb: any = {
    id: "fallback",
    generateStructuredOutput: async () => ({ operations: [], reply: "ok" }),
  };
  await new Gateway(broken, {
    fallback: fb,
    allowFallback: true,
    onFallback: (e) => events.push(e),
  }).interpret({
    utterance: "latte",
    order: createOrder("m"),
    catalog: DEMO_CATALOG,
  });
  assert.equal(events.length, 1);
});
test("confirmed noisy transcription memory improves future interpretation", async () => {
  const { extractCorrection } = await import(
    "../../ring-orden-memory/src/index.ts"
  );
  const m = extractCorrection({
    merchant_id: "m",
    observed_text: "abena",
    previous_interpretation: { modifier: "unresolved" },
    corrected_interpretation: { product: "latte", modifier: "oat_milk" },
    confirmed_by_customer: true,
  })!;
  const baseline = interpretDemo("un late de abena", createOrder("m"));
  assert.ok(
    baseline.operations.some((o) => o.action === "request_clarification"),
  );
  const improved = interpretDemo(
    "un late de abena",
    createOrder("m"),
    DEMO_CATALOG,
    [m],
  );
  assert.ok(
    improved.operations.some(
      (o) => o.action === "add_item" && o.modifier_ids?.includes("oat_milk"),
    ),
  );
  assert.ok(
    !improved.operations.some((o) => o.action === "request_clarification"),
  );
});
test("only first repairs a previously shared milk modifier", () => {
  const o = turn(createOrder("m"), "two lattes both oat").order;
  const r = turn(o, "Actually just the first");
  assert.ok(
    r.order.items[0].modifiers.some((m) => m.modifier_id === "oat_milk"),
  );
  assert.equal(r.order.items[1].modifiers.length, 0);
});
test("vocabulary mapping is merchant-specific", async () => {
  const { extractCorrection } = await import(
    "../../ring-orden-memory/src/index.ts"
  );
  const m = extractCorrection({
    merchant_id: "m",
    observed_text: "purple croissant",
    previous_interpretation: { product: "croissant" },
    corrected_interpretation: { product: "ube_croissant" },
    confirmed_by_customer: true,
  })!;
  const r = interpretDemo(
    "a purple croissant",
    createOrder("m"),
    DEMO_CATALOG,
    [m],
  );
  assert.ok(
    r.operations.some(
      (o) => o.action === "add_item" && o.catalog_item_id === "ube_croissant",
    ),
  );
  const foreign = interpretDemo(
    "a purple croissant",
    createOrder("other"),
    DEMO_CATALOG,
    [m],
  );
  assert.ok(
    foreign.operations.some((o) => o.action === "request_clarification"),
  );
});
for (const phrase of [
  "Yes, confirm my order.",
  "yes that is correct",
  "sí confirmo mi pedido",
  "Sí, confirmar el pedido",
])
  test(`explicit consent ${phrase}`, () => {
    const o = turn(createOrder("m"), "one latte").order;
    assert.equal(
      interpretDemo(phrase, o).operations[0].action,
      "confirm_order",
    );
  });
for (const phrase of [
  "do not confirm my order",
  "is it confirmed?",
  "I might confirm later",
  "yes add a latte",
])
  test(`does not infer consent ${phrase}`, () =>
    assert.notEqual(
      interpretDemo(phrase, createOrder("m")).operations[0]?.action,
      "confirm_order",
    ));
for (const endpoint of [
  "https://127.0.0.1/v1",
  "https://10.0.0.1/v1",
  "https://169.254.169.254/v1",
  "https://localhost/v1",
  "https://[::1]/v1",
  "https://service.internal/v1",
])
  test(`model rejects private destination ${endpoint}`, () =>
    assert.throws(
      () => new OpenAICompatibleAdapter({ model: "test", endpoint }),
      /private|local/i,
    ));
test("model fetch does not follow redirects", async () => {
  let redirect: unknown;
  const a = new OpenAICompatibleAdapter({
    model: "test",
    endpoint: "https://example.com",
    fetch: async (_url, init) => {
      redirect = init?.redirect;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  operations: [],
                  reply: "Please clarify",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });
  await a.generateStructuredOutput({
    utterance: "latte",
    order: createOrder("m"),
    catalog: DEMO_CATALOG,
  });
  assert.equal(redirect, "error");
});
test("model cannot add unseen items together with consent", async () => {
  const a = new OpenAICompatibleAdapter({
    model: "test",
    endpoint: "https://example.com",
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  operations: [
                    { action: "add_item", catalog_item_id: "latte" },
                    { action: "confirm_order", confirmed: true },
                  ],
                  reply: "Confirmed",
                }),
              },
            },
          ],
        }),
        { status: 200 },
      ),
  });
  await assert.rejects(
    () =>
      a.generateStructuredOutput({
        utterance: "Yes, confirm my order",
        order: createOrder("m"),
        catalog: DEMO_CATALOG,
      }),
    /confirmation|consent/i,
  );
});
