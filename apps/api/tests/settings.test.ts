import test from "node:test";
import assert from "node:assert/strict";
import { SettingsSchemas, orderingIsOpen } from "../src/settings.ts";
test("business rejects negative price rules, unsupported currency, bad timezone and oversized quantities", () => {
  for (const value of [
    { maximum_order: -5 },
    { tax_rate: 2 },
    { timezone: "not-a-zone" },
    { currency: "US" },
    { maximum_quantity: 500 },
  ])
    assert.equal(SettingsSchemas.business.safeParse(value).success, false);
});
test("phones require international format and model timeouts have finite bounds", () => {
  assert.equal(
    SettingsSchemas.phone.safeParse({ ordering_phone: "555123" }).success,
    false,
  );
  assert.equal(
    SettingsSchemas.phone.safeParse({
      ordering_phone: "+525555123456",
      notification_phone: "",
    }).success,
    true,
  );
  assert.equal(
    SettingsSchemas.model.safeParse({ timeout_ms: -1 }).success,
    false,
  );
});
test("schedule respects merchant timezone, closures and exact closing minute", () => {
  const business = {
    timezone: "America/Mexico_City",
    schedule: { mon: { enabled: true, open: "07:00", close: "20:00" } },
  };
  assert.equal(
    orderingIsOpen(business, new Date("2026-10-26T14:00:00Z")),
    true,
  );
  assert.equal(
    orderingIsOpen(business, new Date("2026-10-27T02:00:00Z")),
    false,
  );
  assert.equal(
    orderingIsOpen(
      { ...business, special_closures: ["2026-10-26"] },
      new Date("2026-10-26T14:00:00Z"),
    ),
    false,
  );
});
test("overnight hours carry forward from previous weekday", () => {
  const business = {
    timezone: "UTC",
    schedule: {
      mon: { enabled: true, open: "20:00", close: "02:00" },
      tue: { enabled: false, open: "07:00", close: "20:00" },
    },
  };
  assert.equal(
    orderingIsOpen(business, new Date("2026-10-27T01:30:00Z")),
    true,
  );
  assert.equal(
    orderingIsOpen(business, new Date("2026-10-27T03:00:00Z")),
    false,
  );
});
test("business schedule validates exact clock formats and disabled days", () => {
  assert.equal(
    SettingsSchemas.business.safeParse({
      schedule: { mon: { enabled: true, open: "25:00", close: "18:00" } },
    }).success,
    false,
  );
  assert.equal(
    SettingsSchemas.business.safeParse({
      schedule: { mon: { enabled: false, open: "07:00", close: "18:00" } },
    }).success,
    true,
  );
});
