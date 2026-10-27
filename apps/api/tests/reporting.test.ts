import { test } from "node:test";
import assert from "node:assert/strict";
import {
  confirmedOrders,
  pendingPayments,
  inPeriod,
} from "../../merchant-dashboard/reporting.ts";
const order = (
  status: string,
  payment_status = "PENDING",
  created_at = "2026-10-27T20:00:00Z",
) => ({ status, payment_status, created_at, id: status, total: 100 });
test("reporting excludes drafts, clarification and escalations from confirmed sales", () => {
  assert.deepEqual(
    confirmedOrders(
      [
        "DRAFT",
        "AWAITING_CONFIRMATION",
        "AWAITING_CLARIFICATION",
        "ESCALATED",
        "CONFIRMED",
        "PAID",
        "COMPLETED",
        "CANCELLED",
      ].map((s) => order(s)),
    ).map((o) => o.status),
    ["CONFIRMED", "PAID", "COMPLETED"],
  );
});
test("receivables include confirmed pending payments only", () => {
  assert.deepEqual(
    pendingPayments([
      order("DRAFT"),
      order("ESCALATED"),
      order("CANCELLED"),
      order("CONFIRMED"),
      order("PAID", "PAID"),
      order("PAYMENT_PENDING"),
    ]).map((o) => o.status),
    ["CONFIRMED", "PAYMENT_PENDING"],
  );
});
test("today uses merchant timezone around midnight", () => {
  const entries = [
    order("PAID", "PAID", "2026-10-28T02:00:00Z"),
    order("PAID", "PAID", "2026-10-27T03:00:00Z"),
  ];
  assert.equal(
    inPeriod(
      entries,
      "Today",
      "America/Mexico_City",
      new Date("2026-10-28T03:00:00Z"),
    ).length,
    1,
  );
  assert.equal(
    inPeriod(
      entries,
      "Today",
      "Europe/Madrid",
      new Date("2026-10-28T03:00:00Z"),
    ).length,
    1,
  );
});
test("last seven days excludes old and future records", () => {
  const now = new Date("2026-10-27T20:00:00Z");
  assert.equal(
    inPeriod(
      [
        order("PAID"),
        order("PAID", "PAID", "2026-10-19T20:00:00Z"),
        order("PAID", "PAID", "2026-10-28T20:00:00Z"),
      ],
      "Last 7 days",
      "America/Mexico_City",
      now,
    ).length,
    1,
  );
});
