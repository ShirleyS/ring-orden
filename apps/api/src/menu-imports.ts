import {
  CatalogItemSchema,
  type CatalogItem,
} from "../../../packages/ring-orden-core/src/index.ts";
import { HttpError } from "./auth.ts";
import type { TenantState, MenuImportBatch } from "./types.ts";
const nameKey = (name: string) =>
  name.trim().normalize("NFC").toLocaleLowerCase();
/** Recover only products whose IDs were returned by a successful earlier bulk import. */
function menuImports(state: TenantState): MenuImportBatch[] {
  const batches = (state.menu_imports ??= []);
  const covered = new Set(
    batches.flatMap((batch) => batch.items.map((item) => item.id)),
  );
  const current = new Map(state.catalog.map((item) => [item.id, item]));
  for (const [key, cached] of Object.entries(state.requests).reverse()) {
    if (
      !key.includes(":POST:/api/menu/import:") ||
      !cached.result ||
      typeof cached.result !== "object"
    )
      continue;
    const items = (cached.result as { items?: unknown }).items;
    if (!Array.isArray(items)) continue;
    const recovered: CatalogItem[] = [];
    for (const value of items) {
      const parsed = CatalogItemSchema.safeParse(value);
      if (!parsed.success || covered.has(parsed.data.id)) continue;
      const item = current.get(parsed.data.id);
      if (!item) continue;
      recovered.push(structuredClone(item));
      covered.add(item.id);
    }
    if (!recovered.length) continue;
    batches.push({
      id: "recovered_" + recovered[0].id,
      label: "Earlier menu import",
      source: "recovered",
      created_at: null,
      status: "active",
      items: recovered,
    });
  }
  return batches;
}
function summary(state: TenantState, batch: MenuImportBatch) {
  const current = new Set(state.catalog.map((item) => item.id));
  return {
    id: batch.id,
    label: batch.label,
    source: batch.source,
    created_at: batch.created_at,
    status: batch.status,
    ...(batch.unloaded_at ? { unloaded_at: batch.unloaded_at } : {}),
    ...(batch.replaced_by ? { replaced_by: batch.replaced_by } : {}),
    product_count: batch.items.length,
    active_count:
      batch.status === "active"
        ? batch.items.filter((item) => current.has(item.id)).length
        : 0,
    item_ids: batch.items.map((item) => item.id),
  };
}
export function listMenuImports(state: TenantState) {
  return menuImports(state).map((batch) => summary(state, batch));
}
function findBatch(state: TenantState, id: string) {
  const batch = menuImports(state).find((batch) => batch.id === id);
  if (!batch)
    throw new HttpError(404, "Menu upload not found in this workspace.");
  return batch;
}
function assertNoActiveCarts(state: TenantState, ids: Set<string>) {
  const count = state.orders.filter(
    (order) =>
      ["DRAFT", "AWAITING_CLARIFICATION", "AWAITING_CONFIRMATION"].includes(
        order.status,
      ) && order.items.some((item) => ids.has(item.catalog_item_id)),
  ).length;
  if (count)
    throw new HttpError(
      409,
      `${count} unconfirmed ${count === 1 ? "order uses" : "orders use"} products from this upload. Finish or cancel those orders before unloading or replacing it.`,
    );
}
function validateNames(
  catalog: CatalogItem[],
  items: CatalogItem[],
  restoreSnapshot = false,
) {
  const names = new Set(catalog.map((item) => nameKey(item.name)));
  const ids = new Set(catalog.map((item) => item.id));
  for (const item of items) {
    if (names.has(nameKey(item.name)) || ids.has(item.id))
      throw new HttpError(
        409,
        `Your menu already includes ${item.name}. Unload the conflicting upload or change the product name first.`,
      );
    // Restoring must preserve the exact prior state, including names later edited to match.
    // Existing active names and duplicate IDs are still conflicts.
    if (!restoreSnapshot) names.add(nameKey(item.name));
    ids.add(item.id);
  }
}
function archive(
  state: TenantState,
  batch: MenuImportBatch,
  replacedBy?: string,
) {
  const ids = new Set(batch.items.map((item) => item.id));
  const current = new Map(state.catalog.map((item) => [item.id, item]));
  const count = state.catalog.filter((item) => ids.has(item.id)).length;
  // Preserve edits made since import so restoring does not silently roll them back.
  batch.items = batch.items.map((item) =>
    structuredClone(current.get(item.id) ?? item),
  );
  state.catalog = state.catalog.filter((item) => !ids.has(item.id));
  batch.status = "unloaded";
  batch.unloaded_at = new Date().toISOString();
  if (replacedBy) batch.replaced_by = replacedBy;
  else delete batch.replaced_by;
  return count;
}
export function addMenuImport(
  state: TenantState,
  items: CatalogItem[],
  options: {
    label: string;
    source: "photo" | "csv";
    replace_import_ids: string[];
  },
) {
  menuImports(state);
  if (
    new Set(options.replace_import_ids).size !==
    options.replace_import_ids.length
  )
    throw new HttpError(422, "Choose each upload to replace only once.");
  const replaced = options.replace_import_ids.map((id) => findBatch(state, id));
  if (replaced.some((batch) => batch.status !== "active"))
    throw new HttpError(
      409,
      "One of the selected uploads is already unloaded. Refresh the menu and choose again.",
    );
  const removedIDs = new Set(
    replaced.flatMap((batch) => batch.items.map((item) => item.id)),
  );
  assertNoActiveCarts(state, removedIDs);
  const remaining = state.catalog.filter((item) => !removedIDs.has(item.id));
  validateNames(remaining, items);
  const batch: MenuImportBatch = {
    id: "menu_import_" + crypto.randomUUID(),
    label: options.label.replace(/[\u0000-\u001f]/g, " "),
    source: options.source,
    created_at: new Date().toISOString(),
    status: "active",
    items: structuredClone(items),
  };
  for (const prior of replaced) archive(state, prior, batch.id);
  state.catalog.push(...items);
  state.menu_imports!.unshift(batch);
  return summary(state, batch);
}
export function unloadMenuImport(state: TenantState, id: string) {
  const batch = findBatch(state, id);
  if (batch.status === "unloaded")
    return { import: summary(state, batch), count: 0 };
  assertNoActiveCarts(state, new Set(batch.items.map((item) => item.id)));
  const count = archive(state, batch);
  return { import: summary(state, batch), count };
}
export function restoreMenuImport(state: TenantState, id: string) {
  const batch = findBatch(state, id);
  if (batch.status === "active")
    return { import: summary(state, batch), count: 0 };
  const items = batch.items.map((item) => CatalogItemSchema.parse(item));
  validateNames(state.catalog, items, true);
  state.catalog.push(...structuredClone(items));
  batch.status = "active";
  delete batch.unloaded_at;
  delete batch.replaced_by;
  return { import: summary(state, batch), count: items.length };
}
