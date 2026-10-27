type Entry = { status?: string; payment_status?: string; created_at: string };
const confirmed = new Set([
  "CONFIRMED",
  "PAYMENT_PENDING",
  "PAID",
  "POS_SYNC_PENDING",
  "POS_SYNCED",
  "POS_SYNC_FAILED",
  "PREPARING",
  "READY",
  "COMPLETED",
  "REFUND_PENDING",
  "REFUNDED",
]);
export function confirmedOrders<T extends Entry>(entries: T[]): T[] {
  return entries.filter((e) => confirmed.has(e.status || ""));
}
export function pendingPayments<T extends Entry>(entries: T[]): T[] {
  return confirmedOrders(entries).filter((e) => e.payment_status === "PENDING");
}
export function inPeriod<T extends Entry>(
  entries: T[],
  period: string,
  timezone: string,
  now = new Date(),
): T[] {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
  const today = fmt.format(now);
  return entries.filter((entry) => {
    const date = new Date(entry.created_at);
    if (!Number.isFinite(date.getTime()) || date > now) return false;
    if (period === "Today") return fmt.format(date) === today;
    return (
      date.getTime() >=
      now.getTime() - (period === "Last 7 days" ? 7 : 30) * 86400000
    );
  });
}
