import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../../../packages/ring-orden-core/src/index.ts";
import { seedTenant } from "../src/seed.ts";
import { MemoryRepository } from "../src/repository.ts";
import {
  issueCustomerCapabilityLink,
  handleCustomerCapability,
} from "../src/customer-capabilities.ts";
const env = { CUSTOMER_APP_ORIGIN: "https://order.example" };
async function fixture() {
  const state = seedTenant(
    "merchant_capability",
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      provider: "sites",
    },
    false,
  );
  const order = createOrder(state.merchant.id, "order_receipt");
  order.customer = { name: "Ana", phone: "+525555550123" };
  order.status = "COMPLETED";
  order.payment_status = "PAID";
  state.orders.push(order);
  const receipt = await issueCustomerCapabilityLink(
    state,
    order,
    "receipt",
    env,
  );
  const billing = await issueCustomerCapabilityLink(
    state,
    order,
    "billing",
    env,
  );
  const repo = new MemoryRepository();
  await repo.create(state.merchant.id, "owner", state);
  const call = async (
    scope: string,
    token: string,
    method = "GET",
    body?: unknown,
    origin = "https://order.example",
  ) => {
    const response = await handleCustomerCapability(
      new Request(`https://api.example/api/customer/${scope}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: origin,
          "Content-Type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      env,
      repo,
    );
    return {
      status: response?.status,
      data: response?.status === 204 ? null : ((await response?.json()) as any),
      response,
    };
  };
  return {
    state,
    order,
    repo,
    receipt,
    billing,
    receiptToken: new URL(receipt.url).hash.slice(1),
    billingToken: new URL(billing.url).hash.slice(1),
    call,
  };
}
test("completed receipt grant exposes safe order fields and no edit capability or fiscal/contact data", async () => {
  const f = await fixture();
  assert.equal(new URL(f.receipt.url).pathname, "/customer");
  assert.equal(new URL(f.receipt.url).searchParams.get("purpose"), "receipt");
  assert.equal(f.state.order_metadata[f.order.id]?.customer_link, undefined);
  const response = await f.call("receipt", f.receiptToken);
  assert.equal(response.status, 200);
  assert.equal(response.data.order.payment_status, "PAID");
  for (const field of [
    "phone",
    "customer_link",
    "hash",
    "sessions",
    "rfc",
    "legal_name",
    "merchant_id",
    "order_id",
  ])
    assert.equal(JSON.stringify(response.data).includes(field), false, field);
  assert.equal(response.response?.headers.get("Cache-Control"), "no-store");
  assert.equal((await f.call("billing", f.receiptToken)).status, 401);
  assert.equal((await f.call("receipt", f.billingToken)).status, 401);
  assert.equal(
    (await f.call("receipt", f.receiptToken, "POST", {})).status,
    405,
  );
});
test("capability auth enforces exact origin, token integrity, expiry, and bounded scope", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const f = await fixture();
  assert.equal(
    (
      await f.call(
        "receipt",
        f.receiptToken,
        "GET",
        undefined,
        "https://evil.example",
      )
    ).status,
    403,
  );
  assert.equal(
    (await f.call("receipt", `${f.receiptToken.slice(0, -8)}abcdefgh`)).status,
    401,
  );
  assert.equal(
    (await f.call("billing", f.billingToken, "OPTIONS")).status,
    204,
  );
  t.mock.timers.tick(3_600_000);
  assert.equal((await f.call("receipt", f.receiptToken)).status, 401);
});
test("billing grant accepts confirmed fiscal submission once and never reads values back", async () => {
  const f = await fixture();
  const fiscal = {
    rfc: "XAXX010101000",
    legal_name: "PUBLICO EN GENERAL",
    postal_code: "06000",
    tax_regime: "616",
    cfdi_use: "S01",
    email: "ana@example.test",
    confirmed: true,
  };
  const before = await f.call("billing", f.billingToken);
  assert.equal(before.data.status, "PENDING");
  assert.equal(
    (
      await f.call("billing", f.billingToken, "POST", {
        ...fiscal,
        confirmed: false,
      })
    ).status,
    422,
  );
  const saved = await f.call("billing", f.billingToken, "POST", fiscal);
  assert.equal(saved.status, 200);
  assert.equal(saved.data.saved, true);
  assert.equal(saved.data.status, "ON_FILE");
  assert.equal(
    (await f.call("billing", f.billingToken, "POST", fiscal)).status,
    200,
  );
  assert.equal(
    (
      await f.call("billing", f.billingToken, "POST", {
        ...fiscal,
        email: "changed@example.test",
      })
    ).status,
    409,
  );
  const after = await f.call("billing", f.billingToken);
  assert.equal(after.data.status, "ON_FILE");
  for (const field of [fiscal.rfc, fiscal.legal_name, fiscal.email])
    assert.equal(JSON.stringify(after.data).includes(field), false);
});
test("billing email is optional and blank or omitted replay creates only one profile", async () => {
  const f = await fixture();
  const form = await f.call("billing", f.billingToken);
  assert.equal(form.data.required_fields.includes("email"), false);
  assert.deepEqual(form.data.optional_fields, ["email"]);
  const fiscal = {
    rfc: "XAXX010101000",
    legal_name: "PUBLICO EN GENERAL",
    postal_code: "06000",
    tax_regime: "616",
    cfdi_use: "S01",
    confirmed: true,
  };
  assert.equal(
    (
      await f.call("billing", f.billingToken, "POST", {
        ...fiscal,
        email: "invalid",
      })
    ).status,
    422,
  );
  assert.equal(
    (await f.call("billing", f.billingToken, "POST", fiscal)).status,
    200,
  );
  assert.equal(
    (
      await f.call("billing", f.billingToken, "POST", {
        ...fiscal,
        email: "   ",
      })
    ).status,
    200,
  );
  const saved = (await f.repo.loadByMerchant(f.state.merchant.id))!;
  assert.equal(saved.state.customer_memory!.billing_profiles.length, 1);
  assert.equal(
    saved.state.customer_memory!.billing_profiles[0].email,
    undefined,
  );
  assert.equal(
    saved.state.customer_memory!.invoice_requests.length,
    0,
    "saving fiscal data does not issue or request an invoice",
  );
});
test("unknown capability routes fall through without reading or mutating state", async () => {
  assert.equal(
    await handleCustomerCapability(
      new Request("https://api.example/api/customer/order"),
      env,
      new MemoryRepository(),
    ),
    undefined,
  );
});
