import { test } from "node:test";
import assert from "node:assert/strict";
import { adaptNetlifyRequest } from "../../../netlify/adapter.ts";
import { identityFromRequest } from "../src/auth.ts";
test("Netlify public request cannot supply platform identity headers", async () => {
  const req = new Request("https://ring-orden.netlify.app/api/bootstrap", {
    headers: {
      "oai-authenticated-user-id": "victim",
      "oai-authenticated-user-email": "victim@example.com",
    },
  });
  const result = adaptNetlifyRequest(
    req,
    {},
    { TRUST_SITES_HEADERS: "true", DEMO_MODE: "false" },
  );
  assert.equal(result.request.headers.has("oai-authenticated-user-id"), false);
  await assert.rejects(
    () => identityFromRequest(result.request, result.env),
    /sign in/i,
  );
});
test("Netlify identity comes exclusively from verified context user", async () => {
  const req = new Request("https://ring-orden.netlify.app/api/bootstrap", {
    headers: { "oai-authenticated-user-id": "attacker" },
  });
  const result = adaptNetlifyRequest(
    req,
    {
      user: {
        id: "verified-owner",
        email: "owner@example.com",
      },
    },
    {},
  );
  const user = await identityFromRequest(result.request, result.env);
  assert.equal(user.id, "sites:netlify:verified-owner");
  assert.equal(user.email, "owner@example.com");
});
test("Netlify adapter preserves raw signed webhook body and authorization", async () => {
  const req = new Request(
    "https://ring-orden.netlify.app/api/webhooks/stripe",
    {
      method: "POST",
      headers: { "stripe-signature": "signed", authorization: "Bearer tool" },
      body: '{ "raw": true }',
    },
  );
  const result = adaptNetlifyRequest(req, {}, {});
  assert.equal(await result.request.text(), '{ "raw": true }');
  assert.equal(result.request.headers.get("stripe-signature"), "signed");
  assert.equal(result.request.headers.get("authorization"), "Bearer tool");
});
