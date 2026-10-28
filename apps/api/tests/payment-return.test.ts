import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../../../packages/ring-orden-core/src/index.ts";
import { createCheckout } from "../src/payments.ts";

test("Stripe Checkout returns to public neutral receipt pages, not the API route or private dashboard", async () => {
  const order = createOrder("merchant_test");
  const original = globalThis.fetch;
  let requestBody = "";
  globalThis.fetch = async (_url, init) => {
    requestBody = String(init?.body ?? "");
    return Response.json({ id: "cs_test_123", url: "https://checkout.stripe.com/test" });
  };
  try {
    await createCheckout(order, {
      STRIPE_SECRET_KEY: "sk_test_ring_orden",
      APP_ORIGIN: "https://ring-orden-api.netlify.app",
    });
    const values = new URLSearchParams(requestBody);
    assert.equal(
      values.get("success_url"),
      "https://ring-orden-api.netlify.app/payment-received.html?session_id={CHECKOUT_SESSION_ID}",
    );
    assert.equal(
      values.get("cancel_url"),
      "https://ring-orden-api.netlify.app/payment-cancelled.html",
    );
  } finally {
    globalThis.fetch = original;
  }
});

test("Stripe Checkout requires a configured public origin before using a production payment key", async () => {
  const order = createOrder("merchant_test");
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    return Response.json({ id: "cs_test_123", url: "https://checkout.stripe.com/test" });
  };
  try {
    await assert.rejects(
      () =>
        createCheckout(order, {
          STRIPE_SECRET_KEY: "sk_test_ring_orden",
        }),
      /APP_ORIGIN/,
    );
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = original;
  }
});
