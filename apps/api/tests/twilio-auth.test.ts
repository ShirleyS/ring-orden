import test from "node:test";
import assert from "node:assert/strict";
import { createOrder } from "../../../packages/ring-orden-core/src/index.ts";
import { sendWhatsApp } from "../src/payments.ts";
import { twilioAuthorization } from "../src/twilio-auth.ts";

test("Twilio authorization prefers a complete restricted API key", () => {
  assert.equal(
    twilioAuthorization({
      TWILIO_ACCOUNT_SID: "ACaccount",
      TWILIO_API_KEY_SID: "SKrestricted",
      TWILIO_API_KEY_SECRET: "restricted-secret",
      TWILIO_AUTH_TOKEN: "account-wide-token",
    }),
    "Basic " + btoa("SKrestricted:restricted-secret"),
  );
});

test("a partial API key fails closed instead of falling back to an account token", () => {
  assert.equal(
    twilioAuthorization({
      TWILIO_ACCOUNT_SID: "ACaccount",
      TWILIO_API_KEY_SID: "SKrestricted",
      TWILIO_AUTH_TOKEN: "account-wide-token",
    }),
    null,
  );
});

test("WhatsApp sends with the restricted API key and does not expose credentials", async () => {
  const order = createOrder("merchant_test");
  order.customer.phone = "+525555010101";
  const original = globalThis.fetch;
  let request: { url: string; authorization: string | null } | undefined;
  globalThis.fetch = async (url, init) => {
    request = {
      url: String(url),
      authorization: new Headers(init?.headers).get("Authorization"),
    };
    return Response.json({ sid: "SM123", status: "queued" });
  };
  try {
    const result = await sendWhatsApp(order, undefined, {
      TWILIO_ACCOUNT_SID: "ACaccount",
      TWILIO_API_KEY_SID: "SKrestricted",
      TWILIO_API_KEY_SECRET: "restricted-secret",
      TWILIO_WHATSAPP_FROM: "whatsapp:+14155238886",
    });
    assert.equal(result.id, "SM123");
    assert.equal(
      request?.url,
      "https://api.twilio.com/2010-04-01/Accounts/ACaccount/Messages.json",
    );
    assert.equal(
      request?.authorization,
      "Basic " + btoa("SKrestricted:restricted-secret"),
    );
    assert.equal(JSON.stringify(result).includes("restricted-secret"), false);
  } finally {
    globalThis.fetch = original;
  }
});
