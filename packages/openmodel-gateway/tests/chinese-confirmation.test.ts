import test from "node:test";
import assert from "node:assert/strict";
import { isExplicitConfirmation } from "../src/demo.ts";

test("Chinese confirmation accepts explicit current consent and rejects refusal/uncertainty", () => {
  for (const consent of [
    "确认订单",
    "是的，确认下单。",
    "对，请下单",
    "确认下单",
  ])
    assert.equal(isExplicitConfirmation(consent), true, consent);
  for (const refusal of [
    "不要确认订单",
    "不对，请不要下单",
    "我不确定",
    "确认订单吗？",
    "以后再说",
  ])
    assert.equal(isExplicitConfirmation(refusal), false, refusal);
});

test("polite spoken confirmations do not get stuck in a consent loop", () => {
  for (const consent of [
    "Sí, señor.",
    "Sí, señora.",
    "Yes, sir.",
    "Yes, ma’am.",
    "Sí, es correcto.",
  ])
    assert.equal(isExplicitConfirmation(consent), true, consent);
  for (const refusal of [
    "Sí, señor, pero no confirmes.",
    "Yes sir, but change the order.",
    "Sí, señora, no estoy seguro.",
  ])
    assert.equal(isExplicitConfirmation(refusal), false, refusal);
});
