import test from "node:test";
import assert from "node:assert/strict";
import {
  identityFromRequest,
  tenantIdFor,
  validateMutationOrigin,
} from "../src/auth.ts";
import {
  verifyStripeSignature,
  hmacHex,
  validatePaidSession,
} from "../src/payments.ts";

test("anonymous hosted request cannot become a demo merchant", async () => {
  await assert.rejects(
    identityFromRequest(new Request("https://ring.test/api/bootstrap"), {}),
    /sign in/i,
  );
});
test("loopback demo identity is explicit and isolated", async () => {
  const user = await identityFromRequest(
    new Request("http://localhost:5173/api/bootstrap"),
    {},
  );
  assert.equal(user.id, "local-ring-orden-demo");
  assert.equal(user.provider, "local-demo");
});
test("configured MojoAuth prevents local demo bypass", async () => {
  await assert.rejects(
    identityFromRequest(new Request("http://localhost:5173/api/bootstrap"), {
      MOJOAUTH_JWKS_URL: "https://example.test/jwks",
    }),
    /sign in/i,
  );
});
test("tenant ID is stable and differs by authenticated owner", async () => {
  assert.equal(await tenantIdFor("alice"), await tenantIdFor("alice"));
  assert.notEqual(await tenantIdFor("alice"), await tenantIdFor("bob"));
});
test("cross origin mutation is rejected", () => {
  assert.throws(
    () =>
      validateMutationOrigin(
        new Request("https://ring.test/api/orders", {
          method: "POST",
          headers: { Origin: "https://evil.test" },
        }),
      ),
    /origin/i,
  );
});
test("same origin mutation accepted", () => {
  assert.doesNotThrow(() =>
    validateMutationOrigin(
      new Request("https://ring.test/api/orders", {
        method: "POST",
        headers: { Origin: "https://ring.test" },
      }),
    ),
  );
});
test("valid signed Stripe event verifies and altered raw body fails", async () => {
  const body = '{"id":"evt_1"}';
  const stamp = Math.floor(Date.now() / 1000);
  const signature = await hmacHex("secret", `${stamp}.${body}`);
  assert.equal(
    await verifyStripeSignature(body, `t=${stamp},v1=${signature}`, "secret"),
    true,
  );
  assert.equal(
    await verifyStripeSignature(
      body + " ",
      `t=${stamp},v1=${signature}`,
      "secret",
    ),
    false,
  );
});
test("replayed expired Stripe event signature is rejected", async () => {
  const stamp = Math.floor(Date.now() / 1000) - 400;
  const body = "{}";
  const signature = await hmacHex("secret", `${stamp}.${body}`);
  assert.equal(
    await verifyStripeSignature(body, `t=${stamp},v1=${signature}`, "secret"),
    false,
  );
});
test("unpaid checkout event cannot mark an order paid", () => {
  assert.equal(
    validatePaidSession(
      { payment_status: "unpaid", amount_total: 9000, currency: "mxn" },
      90,
      "MXN",
    ),
    false,
  );
});
test("payment amount and currency must match authoritative order", () => {
  assert.equal(
    validatePaidSession(
      { payment_status: "paid", amount_total: 9000, currency: "mxn" },
      90,
      "MXN",
    ),
    true,
  );
  assert.equal(
    validatePaidSession(
      { payment_status: "paid", amount_total: 1, currency: "mxn" },
      90,
      "MXN",
    ),
    false,
  );
  assert.equal(
    validatePaidSession(
      { payment_status: "paid", amount_total: 9000, currency: "usd" },
      90,
      "MXN",
    ),
    false,
  );
});
test("standalone host rejects forged Sites identity headers even in live mode", async () => {
  const request = new Request("https://standalone.example.org/api/bootstrap", {
    headers: {
      "oai-authenticated-user-id": "forged-owner",
      "oai-authenticated-user-email": "victim@example.com",
    },
  });
  await assert.rejects(
    identityFromRequest(request, { DEMO_MODE: "false" }),
    /sign in/i,
  );
});
test("trusted Sites host retains platform identity and explicit false disables it", async () => {
  const request = new Request("https://ring-orden.chatgpt.site/api/bootstrap", {
    headers: { "oai-authenticated-user-id": "verified-platform-user" },
  });
  assert.equal(
    (await identityFromRequest(request, {})).id,
    "sites:verified-platform-user",
  );
  await assert.rejects(
    identityFromRequest(request, {
      TRUST_SITES_HEADERS: "false",
      DEMO_MODE: "false",
    }),
    /sign in/i,
  );
});
test("explicit trusted proxy setting enables verified injected headers on custom host", async () => {
  const request = new Request("https://trusted-proxy.example/api/bootstrap", {
    headers: { "oai-authenticated-user-id": "proxy-verified-user" },
  });
  assert.equal(
    (await identityFromRequest(request, { TRUST_SITES_HEADERS: "true" })).id,
    "sites:proxy-verified-user",
  );
});
