import test from "node:test";
import assert from "node:assert/strict";
import { waitForCallReceipt } from "../src/call-receipt.ts";
test("waits for the exact ended call order to finish saving before returning its receipt", async () => {
  const seen: string[] = [];
  let attempt = 0;
  const result = await waitForCallReceipt(
    "conv-a",
    async (id) => {
      seen.push(id);
      return ++attempt === 1
        ? { status: "WAITING_SESSION" }
        : attempt === 2
          ? { status: "UNCONFIRMED" }
          : {
              status: "READY",
              message: {
                id: "receipt-a",
                text: "Pago pendiente",
                link: {
                  label: "Ver recibo",
                  url: "https://ringorden.lovable.app/receipt#token",
                },
              },
            };
    },
    { pause: async () => {} },
  );
  assert.equal(result.status, "READY");
  assert.deepEqual(seen, ["conv-a", "conv-a", "conv-a"]);
});
test("an unconfirmed call never fabricates a receipt and polling is bounded", async () => {
  let count = 0;
  const result = await waitForCallReceipt(
    "conv-a",
    async () => {
      count++;
      return { status: "UNCONFIRMED" };
    },
    { attempts: 3, pause: async () => {} },
  );
  assert.equal(result.status, "UNCONFIRMED");
  assert.equal(count, 3);
});
test("closing the dialog cancels late receipt work", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  await assert.rejects(
    waitForCallReceipt(
      "conv-a",
      async () => {
        calls++;
        return { status: "WAITING_SESSION" };
      },
      { signal: controller.signal, pause: async () => {} },
    ),
    /abort/i,
  );
  assert.equal(calls, 0);
});
test("a stalled request times out instead of trapping the call dialog", async () => {
  await assert.rejects(
    waitForCallReceipt("conv-a", () => new Promise(() => {}), {
      attempts: 1,
      requestTimeoutMs: 10,
    }),
    /timed out/i,
  );
});

test('closing during lookup startup aborts even when the request never settles', {timeout:100}, async () => {
  const controller = new AbortController();
  await assert.rejects(waitForCallReceipt('conv-closing', () => {
    controller.abort(new DOMException('Dialog closed', 'AbortError'));
    return new Promise(() => {});
  }, {signal:controller.signal,requestTimeoutMs:10}), /Dialog closed/);
});
