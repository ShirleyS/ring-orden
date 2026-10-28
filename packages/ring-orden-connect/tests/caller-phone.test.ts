import test from "node:test";
import assert from "node:assert/strict";
import { readCallerCommand, appendCallerMessage } from "../src/caller-phone.ts";
const parent = {};
const message = {
  protocol: "browser-phone",
  v: 1,
  session: "nonce",
  type: "message.received",
  id: "receipt-1",
  text: "Order receipt",
  link: {
    label: "Ver recibo",
    url: "https://ringorden.lovable.app/receipt#token",
  },
};
test("caller accepts receipt messages only from the exact parent origin and instance", () => {
  const event = {
    source: parent,
    origin: "https://ring.example",
    data: message,
  };
  assert.deepEqual(
    readCallerCommand(event, parent, event.origin, "nonce"),
    message,
  );
  for (const change of [
    { source: {} },
    { origin: "https://evil.example" },
    { data: { ...message, session: "other" } },
    {
      data: { ...message, link: { label: "bad", url: "javascript:alert(1)" } },
    },
  ])
    assert.equal(
      readCallerCommand({ ...event, ...change }, parent, event.origin, "nonce"),
      null,
    );
});
test("receipt replay after handshake renders one message and retains the real link", () => {
  const item = {
    id: "receipt-1",
    text: "Order receipt",
    link: message.link,
    from: "them" as const,
  };
  let messages = appendCallerMessage([], item);
  messages = appendCallerMessage(messages, item);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].link?.url, message.link.url);
});
