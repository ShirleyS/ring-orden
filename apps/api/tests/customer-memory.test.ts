import test from "node:test";
import assert from "node:assert/strict";
import { seedTenant } from "../src/seed.ts";
import {
  createOrder,
  applyOperation,
} from "../../../packages/ring-orden-core/src/index.ts";
import { HttpError } from "../src/auth.ts";
import type { TenantState, Session } from "../src/types.ts";
import {
  normalizePhone,
  handleCustomerTool,
  handleCustomerMerchant,
  issueCustomerVerificationChallenge,
  completeCustomerVerification,
  readCustomerVerificationTenant,
} from "../src/customer-memory.ts";

const env = { CUSTOMER_APP_ORIGIN: "https://customer.example" };
function fixture(merchant = "merchant_a") {
  const state = seedTenant(
    merchant,
    {
      id: "owner",
      name: "Owner",
      email: "owner@example.test",
      provider: "sites",
    },
    false,
  );
  let previous = createOrder(merchant, "order_previous");
  previous.customer = { name: "Ana", phone: "+52 55 5555 0123" };
  previous = applyOperation(
    previous,
    {
      action: "add_item",
      catalog_item_id: "latte",
      modifier_ids: ["oat_milk"],
    },
    state.catalog,
  );
  previous.status = "COMPLETED";
  previous.payment_status = "PAID";
  const current = createOrder(merchant, "order_current");
  current.customer = { name: "Ana", phone: "+525555550123" };
  const session: Session = {
    id: "session_current",
    order_id: current.id,
    turns: [],
    created_at: new Date().toISOString(),
    status: "ACTIVE",
    pending_corrections: [],
  };
  state.orders.push(previous, current);
  state.sessions.push(session);
  const tool = (name: string, body: Record<string, unknown> = {}) =>
    handleCustomerTool(state, name, body, session, env) as Promise<any>;
  return { state, session, previous, current, tool };
}
function memory(state: TenantState): any {
  return (state as any).customer_memory;
}
async function verify(f: ReturnType<typeof fixture>) {
  const challenge = await issueCustomerVerificationChallenge(
    f.state,
    f.session,
    env,
  );
  await completeCustomerVerification(f.state, challenge.token);
  return challenge;
}
function rejectsStatus(status: number) {
  return (error: unknown) =>
    error instanceof HttpError && error.status === status;
}

test("phone normalization is explicit E.164 and rejects local and malformed ambiguity", () => {
  assert.equal(normalizePhone(" +52 (55) 5555-0123 "), "+525555550123");
  assert.equal(normalizePhone("+1 415 555 0123"), "+14155550123");
  for (const input of [
    "5555550123",
    "+52abc5555550123",
    "+0525555550123",
    "+52",
    "+525555550123 ext 2",
    "++525555550123",
    null,
  ])
    assert.equal(normalizePhone(input), null);
});

test("recognition derives only from canonical session order and never asserts verification", async () => {
  const f = fixture();
  const context = await f.tool("get_customer_context", {
    phone: "+14155550123",
    customer_id: "foreign",
    verified: true,
  });
  assert.equal(context.recognized, true);
  assert.equal(context.verified, false);
  assert.equal(JSON.stringify(context).includes("+525555550123"), false);
  await assert.rejects(
    f.tool("get_previous_orders", { verified: true }),
    rejectsStatus(403),
  );
  const other = fixture("merchant_b");
  assert.notEqual(
    (await other.tool("get_customer_context")).customer_id,
    context.customer_id,
  );
  await assert.rejects(
    handleCustomerTool(other.state, "get_customer_context", {}, f.session, env),
    rejectsStatus(403),
  );
});

test("unbound sessions, foreign canonical orders and duplicate ambiguous customers fail closed", async () => {
  const f = fixture();
  const forged = { ...f.session, id: "session_forged" };
  await assert.rejects(
    handleCustomerTool(f.state, "get_customer_context", {}, forged, env),
    rejectsStatus(403),
  );
  f.current.merchant_id = "merchant_b";
  await assert.rejects(f.tool("get_customer_context"), rejectsStatus(404));
  const duplicate = fixture();
  await duplicate.tool("get_customer_context");
  memory(duplicate.state).customers.push({
    ...memory(duplicate.state).customers[0],
    id: "customer_duplicate",
  });
  await assert.rejects(
    duplicate.tool("get_customer_context"),
    rejectsStatus(409),
  );
});

test("permanent preferences require verification, explicit confirmation and permanent scope", async () => {
  const f = fixture();
  await f.tool("get_customer_context");
  await assert.rejects(
    f.tool("update_customer_preference", {
      key: "milk",
      value: "almond",
      confirmed: true,
      scope: "permanent",
    }),
    rejectsStatus(403),
  );
  const once = await f.tool("update_customer_preference", {
    key: "milk",
    value: "almond",
    scope: "order",
  });
  assert.equal(once.saved, false);
  assert.equal(memory(f.state).preferences.length, 0);
  await verify(f);
  await assert.rejects(
    f.tool("update_customer_preference", {
      key: "milk",
      value: "almond",
      scope: "permanent",
    }),
    rejectsStatus(422),
  );
  const saved = await f.tool("update_customer_preference", {
    key: "milk",
    value: "almond",
    confirmed: true,
    scope: "permanent",
  });
  assert.equal(saved.preference.source, "explicit");
  const fresh = { ...f.session, id: "session_fresh" };
  f.state.sessions.push(fresh);
  const context: any = await handleCustomerTool(
    f.state,
    "get_customer_context",
    {},
    fresh,
    env,
  );
  assert.equal(context.customer_id, saved.customer_id);
  assert.equal(memory(f.state).preferences[0].value, "almond");
});

test("deterministic completed-order inference is separate and never overwrites explicit memory", async () => {
  const f = fixture();
  await verify(f);
  await f.tool("update_customer_preference", {
    key: "favorite_item",
    value: "americano",
    confirmed: true,
    scope: "permanent",
  });
  const result = await f.tool("get_customer_preferences");
  assert.equal(
    result.explicit.find((p: any) => p.key === "favorite_item").value,
    "americano",
  );
  assert.equal(
    result.inferred.find((p: any) => p.key === "favorite_item").value,
    "latte",
  );
  assert.equal(result.inferred[0].source, "inferred");
  f.previous.status = "CANCELLED";
  assert.equal((await f.tool("get_customer_preferences")).inferred.length, 0);
});

test("verification capabilities are hashed, single-use, expired and session/customer scoped", async () => {
  const f = fixture();
  const voice = await f.tool("verify_customer", { verified: true });
  assert.equal(voice.delivery_status, "NOT_CONFIGURED");
  for (const secretName of ["token", "secret", "code"])
    assert.equal(voice[secretName], undefined);
  const grant = await issueCustomerVerificationChallenge(
    f.state,
    f.session,
    env,
  );
  assert.equal(readCustomerVerificationTenant(grant.token), "merchant_a");
  assert.equal(JSON.stringify(f.state).includes(grant.token), false);
  assert.equal(
    JSON.stringify(f.state).includes(
      JSON.parse(Buffer.from(grant.token, "base64url").toString()).secret,
    ),
    false,
  );
  assert.equal(new URL(grant.url).hash.slice(1), grant.token);
  assert.equal(new URL(grant.url).pathname, "/customer");
  assert.equal(new URL(grant.url).searchParams.get("purpose"), "verify");
  await assert.rejects(
    completeCustomerVerification(fixture("merchant_b").state, grant.token),
    rejectsStatus(401),
  );
  await completeCustomerVerification(f.state, grant.token);
  assert.equal((await f.tool("get_customer_context")).verified, true);
  await assert.rejects(
    completeCustomerVerification(f.state, grant.token),
    rejectsStatus(401),
  );
  const fresh = { ...f.session, id: "session_fresh" };
  f.state.sessions.push(fresh);
  await assert.rejects(
    handleCustomerTool(f.state, "get_previous_orders", {}, fresh, env),
    rejectsStatus(403),
  );
  memory(f.state).verifications[0].expires_at = new Date(
    Date.now() - 1,
  ).toISOString();
  await assert.rejects(f.tool("get_previous_orders"), rejectsStatus(403));
});

test("expired challenges and phone changes never establish authority", async () => {
  const f = fixture();
  const challenge = await issueCustomerVerificationChallenge(
    f.state,
    f.session,
    env,
  );
  memory(f.state).challenges[0].expires_at = new Date(
    Date.now() - 1,
  ).toISOString();
  await assert.rejects(
    completeCustomerVerification(f.state, challenge.token),
    rejectsStatus(401),
  );
  const current = await issueCustomerVerificationChallenge(
    f.state,
    f.session,
    env,
  );
  f.current.customer.phone = "+14155550123";
  await assert.rejects(
    completeCustomerVerification(f.state, current.token),
    rejectsStatus(401),
  );
});

test("verified history is tenant/customer scoped and reorder uses current catalog draft prices", async () => {
  const f = fixture();
  const unrelated = createOrder("merchant_a", "order_unrelated");
  unrelated.customer.phone = "+14155550123";
  unrelated.status = "COMPLETED";
  f.state.orders.push(unrelated);
  await verify(f);
  const history = await f.tool("get_previous_orders");
  assert.deepEqual(
    history.orders.map((o: any) => o.id),
    [f.previous.id],
  );
  assert.equal(JSON.stringify(history).includes("phone"), false);
  f.state.catalog.find((i) => i.id === "latte")!.price = 99;
  const reordered = await f.tool("reorder_previous_order", {
    order_id: f.previous.id,
  });
  assert.equal(reordered.status, "DRAFT");
  assert.equal(reordered.requires_confirmation, true);
  const draft = f.state.orders.find((o) => o.id === reordered.order_id)!;
  assert.equal(draft.total, 111);
  assert.equal(draft.payment_status, "PENDING");
  assert.notEqual(reordered.session_id, f.session.id);
  assert.equal(f.previous.total, 86);
  await assert.rejects(
    f.tool("reorder_previous_order", { order_id: unrelated.id }),
    rejectsStatus(404),
  );
});

test("unavailable previous items do not create an invalid reorder", async () => {
  const f = fixture();
  await verify(f);
  f.state.catalog.find((i) => i.id === "latte")!.available = false;
  const before = f.state.orders.length;
  const result = await f.tool("reorder_previous_order", {
    order_id: f.previous.id,
  });
  assert.equal(result.status, "UNAVAILABLE");
  assert.equal(f.state.orders.length, before);
});

test("billing fiscal values are owner-only and invoice requests stay pending and idempotent", async () => {
  const f = fixture();
  await f.tool("get_customer_context");
  const id = memory(f.state).customers[0].id;
  const fiscal = {
    rfc: "XAXX010101000",
    legal_name: "ANA EXAMPLE",
    postal_code: "01000",
    tax_regime: "616",
    cfdi_use: "S01",
    email: "ana@example.test",
  };
  assert.throws(
    () =>
      handleCustomerMerchant(
        f.state,
        ["customers", id, "billing"],
        "PATCH",
        fiscal,
        "MANAGER",
      ),
    rejectsStatus(403),
  );
  handleCustomerMerchant(
    f.state,
    ["customers", id, "billing"],
    "PATCH",
    fiscal,
    "OWNER",
  );
  await assert.rejects(
    f.tool("get_billing_profile_status", { verified: true }),
    rejectsStatus(403),
  );
  await verify(f);
  const status = await f.tool("get_billing_profile_status");
  assert.equal(status.status, "ON_FILE");
  assert.equal(JSON.stringify(status).includes(fiscal.rfc), false);
  const invoice = await f.tool("request_invoice", {
    order_id: f.previous.id,
    confirmed: true,
  });
  assert.equal(invoice.status, "PENDING_PROVIDER");
  assert.equal(invoice.issued, false);
  assert.deepEqual(
    await f.tool("request_invoice", {
      order_id: f.previous.id,
      confirmed: true,
    }),
    invoice,
  );
  assert.equal(memory(f.state).invoice_requests.length, 1);
  assert.equal(
    JSON.stringify(
      handleCustomerMerchant(f.state, ["customers", id], "GET", {}, "OWNER"),
    ).includes(fiscal.rfc),
    false,
  );
});

test("merchant controls enforce roles, tenant ids and audit explicit changes without leaking billing", async () => {
  const f = fixture();
  await f.tool("get_customer_context");
  const id = memory(f.state).customers[0].id;
  assert.throws(
    () => handleCustomerMerchant(f.state, ["customers"], "GET", {}, "STAFF"),
    rejectsStatus(403),
  );
  const list: any = handleCustomerMerchant(
    f.state,
    ["customers"],
    "GET",
    {},
    "MANAGER",
  );
  assert.equal(list.customers[0].display_name, "Ana");
  assert.throws(
    () =>
      handleCustomerMerchant(
        f.state,
        ["customers", id],
        "PATCH",
        { name: "New" },
        "STAFF",
      ),
    rejectsStatus(403),
  );
  handleCustomerMerchant(
    f.state,
    ["customers", id],
    "PATCH",
    { name: "Ana Maria", preferred_language: "zh-CN" },
    "MANAGER",
  );
  const preference: any = handleCustomerMerchant(
    f.state,
    ["customers", id, "preferences"],
    "POST",
    {
      preference_key: "milk",
      preference_value: "oat",
      confirmed: true,
      scope: "permanent",
    },
    "MANAGER",
  );
  assert.equal(preference.preference.source, "explicit");
  handleCustomerMerchant(
    f.state,
    ["customers", id, "preferences", preference.preference.id],
    "DELETE",
    {},
    "OWNER",
  );
  const detail: any = handleCustomerMerchant(
    f.state,
    ["customers", id],
    "GET",
    {},
    "MANAGER",
  );
  assert.equal(detail.customer.preferred_language, "zh-CN");
  assert.equal(detail.preferences.explicit.length, 0);
  assert.ok(detail.events.length >= 3);
  assert.throws(
    () =>
      handleCustomerMerchant(
        fixture("merchant_b").state,
        ["customers", id],
        "GET",
        {},
        "OWNER",
      ),
    rejectsStatus(404),
  );
});

test("multiple billing profiles create separately and edits require an own explicit profile id", async () => {
  const f = fixture();
  await f.tool("get_customer_context");
  const customerId = memory(f.state).customers[0].id;
  const fiscal = {
    rfc: "XAXX010101000",
    legal_name: "ANA EXAMPLE",
    postal_code: "01000",
    tax_regime: "616",
    cfdi_use: "S01",
  };
  const first: any = handleCustomerMerchant(
    f.state,
    ["customers", customerId, "billing"],
    "POST",
    { ...fiscal, alias: "Personal" },
    "OWNER",
  );
  const second: any = handleCustomerMerchant(
    f.state,
    ["customers", customerId, "billing"],
    "POST",
    { ...fiscal, alias: "Work", email: "work@example.test" },
    "OWNER",
  );
  assert.notEqual(first.profile_id, second.profile_id);
  assert.equal(memory(f.state).billing_profiles.length, 2);
  handleCustomerMerchant(
    f.state,
    ["customers", customerId, "billing"],
    "PATCH",
    {
      ...fiscal,
      profile_id: first.profile_id,
      alias: "Home",
      is_default: true,
    },
    "OWNER",
  );
  assert.equal(memory(f.state).billing_profiles.length, 2);
  const listing: any = handleCustomerMerchant(
    f.state,
    ["customers", customerId, "billing"],
    "GET",
    {},
    "OWNER",
  );
  assert.equal(listing.profiles.length, 2);
  assert.equal(listing.profiles[0].alias, "Home");
  for (const value of [
    fiscal.rfc,
    fiscal.legal_name,
    "work@example.test",
    fiscal.postal_code,
  ])
    assert.equal(JSON.stringify(listing).includes(value), false);
  assert.throws(
    () =>
      handleCustomerMerchant(
        f.state,
        ["customers", customerId, "billing"],
        "PATCH",
        { ...fiscal, profile_id: "foreign_profile" },
        "OWNER",
      ),
    rejectsStatus(404),
  );
  await verify(f);
  const requested = await f.tool("request_invoice", {
    order_id: f.previous.id,
    profile_id: second.profile_id,
    confirmed: true,
  });
  assert.equal(requested.status, "PENDING_PROVIDER");
  assert.equal(
    memory(f.state).invoice_requests[0].profile_id,
    second.profile_id,
  );
});

test("owner data requests remain pending review and never claim erasure or export completion", async () => {
  const f = fixture();
  await f.tool("get_customer_context");
  const customerId = memory(f.state).customers[0].id;
  assert.throws(
    () =>
      handleCustomerMerchant(
        f.state,
        ["customers", customerId, "data-requests"],
        "POST",
        { type: "deletion", confirmed: true },
        "MANAGER",
      ),
    rejectsStatus(403),
  );
  const result: any = handleCustomerMerchant(
    f.state,
    ["customers", customerId, "data-requests"],
    "POST",
    { type: "deletion", confirmed: true },
    "OWNER",
  );
  assert.equal(result.request.status, "PENDING_REVIEW");
  assert.equal(result.completed, false);
  assert.equal(f.state.orders.length, 2);
  assert.equal(memory(f.state).customers.length, 1);
  assert.equal(
    (
      handleCustomerMerchant(
        f.state,
        ["customers", customerId, "data-requests"],
        "GET",
        {},
        "OWNER",
      ) as any
    ).requests.length,
    1,
  );
});

test("history query modes and bounded limits are explicit and unsupported locations fail", async () => {
  const f = fixture();
  await verify(f);
  const repeat = structuredClone(f.previous);
  repeat.id = "order_repeat";
  repeat.created_at = new Date(Date.now() + 1000).toISOString();
  f.state.orders.push(repeat);
  const different = structuredClone(f.previous);
  different.id = "order_different";
  different.items = [];
  different.created_at = new Date(Date.now() + 2000).toISOString();
  f.state.orders.push(different);
  assert.equal(
    (await f.tool("get_previous_orders", { mode: "most_recent" })).orders[0].id,
    different.id,
  );
  assert.equal(
    (await f.tool("get_previous_orders", { limit: 1 })).orders.length,
    1,
  );
  const frequent = await f.tool("get_previous_orders", { mode: "frequent" });
  assert.equal(frequent.orders[0].id, repeat.id);
  assert.equal(frequent.orders[0].frequency, 2);
  for (const body of [
    { limit: 0 },
    { limit: 21 },
    { limit: "1" },
    { mode: "anything" },
    { location_id: "another_branch" },
    { location: "Roma" },
  ])
    await assert.rejects(
      f.tool("get_previous_orders", body),
      rejectsStatus(422),
    );
});

test("inferred milk and temperature count completed quantities without changing explicit choices", async () => {
  const f = fixture();
  await verify(f);
  await f.tool("update_customer_preference", {
    key: "milk",
    value: "almond_milk",
    confirmed: true,
    scope: "permanent",
  });
  const prefs = await f.tool("get_customer_preferences");
  assert.equal(
    prefs.explicit.find((p: any) => p.key === "milk").value,
    "almond_milk",
  );
  assert.equal(
    prefs.inferred.find((p: any) => p.key === "milk").value,
    "oat_milk",
  );
  assert.equal(
    prefs.inferred.find((p: any) => p.key === "temperature").value,
    "hot",
  );
});

test("fresh unverified sessions recall only bounded non-sensitive food preferences", async () => {
  const f = fixture();
  await verify(f);
  await f.tool("update_customer_preference", {
    key: "milk",
    value: "oat",
    confirmed: true,
    scope: "permanent",
  });
  await f.tool("update_customer_preference", {
    key: "medical_note",
    value: "private",
    confirmed: true,
    scope: "permanent",
  });
  const fresh = { ...f.session, id: "session_fresh" };
  f.state.sessions.push(fresh);
  const result: any = await handleCustomerTool(
    f.state,
    "get_customer_preferences",
    {},
    fresh,
    env,
  );
  assert.equal(result.verified, false);
  assert.equal(result.verification_required, true);
  assert.equal(result.redacted, true);
  assert.equal(result.explicit.find((p: any) => p.key === "milk").value, "oat");
  assert.equal(JSON.stringify(result).includes("medical_note"), false);
  await assert.rejects(
    handleCustomerTool(f.state, "get_previous_orders", {}, fresh, env),
    rejectsStatus(403),
  );
});

test("verification links reject insecure origins and revoked grants do not authorize", async () => {
  const f = fixture();
  for (const origin of [
    "http://customer.example",
    "https://customer.example/path",
    "https://user:password@customer.example",
    "https://customer.example?next=unsafe",
  ])
    await assert.rejects(
      issueCustomerVerificationChallenge(f.state, f.session, {
        CUSTOMER_APP_ORIGIN: origin,
      }),
      rejectsStatus(503),
    );
  await verify(f);
  memory(f.state).verifications[0].revoked_at = new Date().toISOString();
  await assert.rejects(f.tool("get_previous_orders"), rejectsStatus(403));
});
