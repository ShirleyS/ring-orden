import type { Repository, TenantState } from "./types.ts";
import type { Order } from "../../../packages/ring-orden-core/src/index.ts";
export async function retryDuePOS(
  repo: Repository,
  merchantId: string,
  sync: (state: TenantState, order: Order) => Promise<Order>,
  now = new Date(),
) {
  const initial = await repo.loadByMerchant(merchantId);
  if (!initial) return { results: [] };
  const limit = Math.max(
    1,
    Math.min(5, Number(initial.state.settings.pos.retry_limit ?? 3)),
  );
  const ids = initial.state.orders
    .filter((order) => {
      const meta = initial.state.order_metadata[order.id];
      return (
        (meta?.pos_status === "FAILED" ||
          (meta?.pos_status === "RETRYING" &&
            Date.parse(meta.pos_retry_claimed_at ?? "") <=
              now.getTime() - 120000)) &&
        (meta.pos_attempts ?? 0) < limit &&
        (!meta.pos_next_retry_at ||
          Date.parse(meta.pos_next_retry_at) <= now.getTime())
      );
    })
    .slice(0, 10)
    .map((order) => order.id);
  const results: { order_id: string; status: string; attempts: number }[] = [];
  for (const id of ids) {
    const row = await repo.loadByMerchant(merchantId);
    if (!row) continue;
    const meta = row.state.order_metadata[id];
    const order = row.state.orders.find((o) => o.id === id);
    if (
      !order ||
      !(
        meta?.pos_status === "FAILED" ||
        (meta?.pos_status === "RETRYING" &&
          Date.parse(meta.pos_retry_claimed_at ?? "") <= now.getTime() - 120000)
      ) ||
      (meta.pos_attempts ?? 0) >= limit ||
      (meta.pos_next_retry_at &&
        Date.parse(meta.pos_next_retry_at) > now.getTime())
    )
      continue;
    const claim = crypto.randomUUID();
    meta.pos_status = "RETRYING";
    meta.pos_retry_claim = claim;
    meta.pos_retry_claimed_at = now.toISOString();
    if (!(await repo.saveTrusted(merchantId, row.revision, row.state)))
      continue;
    const updated = await sync(row.state, order);
    delete meta.pos_retry_claim;
    delete meta.pos_retry_claimed_at;
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await repo.loadByMerchant(merchantId);
      if (!latest) break;
      const latestMeta = latest.state.order_metadata[id];
      if (latestMeta.pos_retry_claim !== claim) break;
      latest.state.order_metadata[id] = {
        ...meta,
        customer_link: latestMeta.customer_link,
      };
      const latestOrder = latest.state.orders.find((o) => o.id === id)!;
      if (latestOrder.revision === order.revision)
        latest.state.orders[latest.state.orders.findIndex((o) => o.id === id)] =
          updated;
      const eventIds = new Set(latest.state.events.map((e) => e.id));
      latest.state.events = [
        ...row.state.events.filter((e) => !eventIds.has(e.id)),
        ...latest.state.events,
      ].slice(0, 500);
      const escalationIds = new Set(latest.state.escalations.map((e) => e.id));
      latest.state.escalations = [
        ...row.state.escalations.filter((e) => !escalationIds.has(e.id)),
        ...latest.state.escalations,
      ];
      if (await repo.saveTrusted(merchantId, latest.revision, latest.state))
        break;
    }
    results.push({
      order_id: id,
      status: meta.pos_status,
      attempts: meta.pos_attempts ?? 0,
    });
  }
  return { results };
}
