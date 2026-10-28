import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
import {
  createOrder,
  applyOperation,
} from "../../../packages/ring-orden-core/src/index.ts";
const product = (name = "Imported Latte", price = 78) => ({
  name,
  price,
  category: "Coffee",
  description: "Photo product",
  available: true,
});
function client(repo: MemoryRepository, subject = "owner", workspace?: string) {
  return async (path: string, method = "GET", body?: unknown) => {
    const response = await handleRequest(
      new Request("https://ring.test/api/" + path, {
        method,
        headers: {
          "oai-authenticated-user-id": subject,
          "oai-authenticated-user-email": subject + "@example.com",
          "Content-Type": "application/json",
          ...(workspace ? { "x-ring-orden-workspace": workspace } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      }),
      { TRUST_SITES_HEADERS: "true" },
      repo,
    );
    return { status: response.status, data: (await response.json()) as any };
  };
}
test("new menu uploads expose tracked source labels and product IDs", async () => {
  const run = client(new MemoryRepository());
  const result = await run("menu/import", "POST", {
    items: [product()],
    source: "photo",
    label: "Summer menu.png",
  });
  assert.equal(result.status, 201);
  assert.equal(result.data.import.label, "Summer menu.png");
  assert.equal(result.data.import.source, "photo");
  assert.equal(result.data.import.status, "active");
  assert.deepEqual(
    result.data.import.item_ids,
    result.data.items.map((i: any) => i.id),
  );
  const boot = await run("bootstrap");
  assert.equal(boot.data.menu_imports.length, 1);
  assert.equal(boot.data.menu_imports[0].product_count, 1);
});
test("unload removes only that upload and preserves manual products and order history", async () => {
  const run = client(new MemoryRepository());
  await run("menu", "POST", product("Manual special"));
  const added = await run("menu/import", "POST", { items: [product()] });
  const before = (await run("bootstrap")).data;
  const result = await run(
    `menu/imports/${added.data.import.id}/unload`,
    "POST",
    {},
  );
  assert.equal(result.status, 200);
  const after = (await run("bootstrap")).data;
  assert.equal(
    after.catalog.some((i: any) => i.name === "Imported Latte"),
    false,
  );
  assert.ok(after.catalog.some((i: any) => i.name === "Manual special"));
  assert.deepEqual(after.orders, before.orders);
  assert.equal(after.menu_imports[0].status, "unloaded");
});
test("restore retains edited product details and the original product IDs", async () => {
  const run = client(new MemoryRepository());
  const added = await run("menu/import", "POST", { items: [product()] });
  const id = added.data.items[0].id;
  await run(`menu/${id}`, "PATCH", { price: 91, available: false });
  await run(`menu/imports/${added.data.import.id}/unload`, "POST", {});
  const restored = await run(
    `menu/imports/${added.data.import.id}/restore`,
    "POST",
    {},
  );
  assert.equal(restored.status, 200);
  const row = (await run("bootstrap")).data.catalog.find(
    (i: any) => i.id === id,
  );
  assert.equal(row.price, 91);
  assert.equal(row.available, false);
});
test("a reviewed replacement accepts repeated names from the old upload and swaps atomically", async () => {
  const run = client(new MemoryRepository());
  const original = await run("menu/import", "POST", { items: [product()] });
  const replacement = await run("menu/import", "POST", {
    items: [product("Imported Latte", 99)],
    replace_import_ids: [original.data.import.id],
    label: "Winter menu.png",
  });
  assert.equal(replacement.status, 201);
  const after = (await run("bootstrap")).data;
  assert.equal(
    after.catalog.filter((i: any) => i.name === "Imported Latte").length,
    1,
  );
  assert.equal(
    after.catalog.find((i: any) => i.name === "Imported Latte").price,
    99,
  );
  assert.equal(
    after.menu_imports.find((i: any) => i.id === original.data.import.id)
      .status,
    "unloaded",
  );
});
test("replace-all targets explicit tracked upload IDs and leaves manual items intact", async () => {
  const run = client(new MemoryRepository());
  await run("menu", "POST", product("Manual special"));
  const a = await run("menu/import", "POST", { items: [product("Old A")] });
  const b = await run("menu/import", "POST", {
    items: [product("Old B")],
    source: "csv",
  });
  const result = await run("menu/import", "POST", {
    items: [product("New menu")],
    replace_import_ids: [a.data.import.id, b.data.import.id],
  });
  assert.equal(result.status, 201);
  const catalog = (await run("bootstrap")).data.catalog;
  assert.ok(catalog.some((i: any) => i.name === "Manual special"));
  assert.ok(catalog.some((i: any) => i.name === "New menu"));
  assert.equal(
    catalog.some((i: any) => /^Old /.test(i.name)),
    false,
  );
});
test("a replacement conflict does not unload the current upload or add any new rows", async () => {
  const run = client(new MemoryRepository());
  await run("menu", "POST", product("Manual special"));
  const a = await run("menu/import", "POST", { items: [product()] });
  const result = await run("menu/import", "POST", {
    items: [product("Should not be added"), product("Manual special")],
    replace_import_ids: [a.data.import.id],
  });
  assert.equal(result.status, 409);
  const after = (await run("bootstrap")).data;
  assert.ok(after.catalog.some((i: any) => i.name === "Imported Latte"));
  assert.equal(
    after.catalog.some((i: any) => i.name === "Should not be added"),
    false,
  );
  assert.equal(after.menu_imports[0].status, "active");
});
test("restore with a duplicate active product is rejected without partial restoration", async () => {
  const run = client(new MemoryRepository());
  const a = await run("menu/import", "POST", {
    items: [product(), product("Old pastry")],
  });
  await run(`menu/imports/${a.data.import.id}/unload`, "POST", {});
  await run("menu", "POST", product());
  const restored = await run(
    `menu/imports/${a.data.import.id}/restore`,
    "POST",
    {},
  );
  assert.equal(restored.status, 409);
  assert.equal(
    (await run("bootstrap")).data.catalog.some(
      (i: any) => i.name === "Old pastry",
    ),
    false,
  );
});
test("older photo imports can be recovered from cached product IDs without guessing manual provenance", async () => {
  const repo = new MemoryRepository();
  const run = client(repo);
  await run("menu", "POST", product("Manual special"));
  const a = await run("menu/import", "POST", {
    items: [product()],
    request_id: crypto.randomUUID(),
  });
  const boot = (await run("bootstrap")).data;
  const stored = repo.rows.get(boot.merchant.id)!;
  delete stored.state.menu_imports;
  const recovered = (await run("menu/imports")).data.imports;
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].source, "recovered");
  assert.deepEqual(
    recovered[0].item_ids,
    a.data.items.map((i: any) => i.id),
  );
  await run(`menu/imports/${recovered[0].id}/unload`, "POST", {});
  assert.ok(
    (await run("bootstrap")).data.catalog.some(
      (i: any) => i.name === "Manual special",
    ),
  );
});
test("unloading is blocked while an unconfirmed cart uses its products", async () => {
  const repo = new MemoryRepository();
  const run = client(repo);
  const a = await run("menu/import", "POST", { items: [product()] });
  const boot = (await run("bootstrap")).data;
  const stored = repo.rows.get(boot.merchant.id)!;
  const order = applyOperation(
    createOrder(boot.merchant.id),
    {
      action: "add_item",
      catalog_item_id: a.data.items[0].id,
      quantity: 1,
      modifier_ids: [],
    },
    stored.state.catalog,
  );
  stored.state.orders.push(order);
  const result = await run(
    `menu/imports/${a.data.import.id}/unload`,
    "POST",
    {},
  );
  assert.equal(result.status, 409);
  assert.match(result.data.error, /unconfirmed|in.progress/i);
  assert.ok(
    (await run("bootstrap")).data.catalog.some(
      (i: any) => i.name === "Imported Latte",
    ),
  );
});
test("unload and restore are idempotent and another tenant cannot address the upload", async () => {
  const repo = new MemoryRepository();
  const run = client(repo);
  const a = await run("menu/import", "POST", { items: [product()] });
  const path = `menu/imports/${a.data.import.id}`;
  assert.equal(
    (await client(repo, "stranger")(path + "/unload", "POST", {})).status,
    404,
  );
  assert.equal((await run(path + "/unload", "POST", {})).status, 200);
  assert.equal((await run(path + "/unload", "POST", {})).status, 200);
  assert.equal((await run(path + "/restore", "POST", {})).status, 200);
  assert.equal((await run(path + "/restore", "POST", {})).status, 200);
  assert.equal(
    (await run("bootstrap")).data.catalog.filter(
      (i: any) => i.name === "Imported Latte",
    ).length,
    1,
  );
});

test("completed orders containing an unloaded product keep their original names and prices", async () => {
  const repo = new MemoryRepository();
  const run = client(repo);
  const added = await run("menu/import", "POST", { items: [product()] });
  const boot = (await run("bootstrap")).data;
  const stored = repo.rows.get(boot.merchant.id)!;
  let order = applyOperation(
    createOrder(boot.merchant.id),
    {
      action: "add_item",
      catalog_item_id: added.data.items[0].id,
      quantity: 2,
      modifier_ids: [],
    },
    stored.state.catalog,
  );
  order = { ...order, status: "COMPLETED", payment_status: "PAID" };
  stored.state.orders.push(order);
  stored.state.order_metadata[order.id] = {
    pos_status: "SYNCED",
    notification_status: "SENT",
    demo: true,
  };
  const before = structuredClone(order);
  const result = await run(
    `menu/imports/${added.data.import.id}/unload`,
    "POST",
    {},
  );
  assert.equal(result.status, 200);
  assert.deepEqual(
    repo.rows
      .get(boot.merchant.id)!
      .state.orders.find((item) => item.id === order.id),
    before,
  );
});
test("an invalid product in a replacement preserves every currently active product", async () => {
  const run = client(new MemoryRepository());
  const added = await run("menu/import", "POST", { items: [product()] });
  const before = (await run("bootstrap")).data.catalog;
  const result = await run("menu/import", "POST", {
    items: [{ ...product(), price: null }],
    replace_import_ids: [added.data.import.id],
  });
  assert.equal(result.status, 422);
  assert.deepEqual((await run("bootstrap")).data.catalog, before);
});
test("managers cannot unload imports or see owner upload history", async () => {
  const repo = new MemoryRepository();
  const owner = client(repo);
  const added = await owner("menu/import", "POST", { items: [product()] });
  const boot = (await owner("bootstrap")).data;
  const invite = await owner("team", "POST", {
    name: "Manager",
    email: "manager@example.com",
    role: "MANAGER",
  });
  const token = new URL(invite.data.invite_url).searchParams.get("invite");
  assert.equal(
    (await client(repo, "manager")("team/accept", "POST", { token })).status,
    200,
  );
  const manager = client(repo, "manager", boot.merchant.id);
  assert.deepEqual((await manager("bootstrap")).data.menu_imports, []);
  assert.equal(
    (await manager(`menu/imports/${added.data.import.id}/unload`, "POST", {}))
      .status,
    403,
  );
  assert.equal(
    (await manager(`menu/imports/${added.data.import.id}/restore`, "POST", {}))
      .status,
    403,
  );
  assert.equal((await manager("menu/imports")).status, 403);
});
test("stale replacement targets do not add a second copy or affect another upload", async () => {
  const run = client(new MemoryRepository());
  const old = await run("menu/import", "POST", { items: [product()] });
  await run(`menu/imports/${old.data.import.id}/unload`, "POST", {});
  const result = await run("menu/import", "POST", {
    items: [product("New row")],
    replace_import_ids: [old.data.import.id],
  });
  assert.equal(result.status, 409);
  assert.equal(
    (await run("bootstrap")).data.catalog.some(
      (item: any) => item.name === "New row",
    ),
    false,
  );
});

test("restoring a batch preserves duplicate names introduced by later manual edits", async () => {
  const run = client(new MemoryRepository());
  const added = await run("menu/import", "POST", {
    items: [product("Original A"), product("Original B")],
  });
  await run(`menu/${added.data.items[1].id}`, "PATCH", { name: "Original A" });
  assert.equal(
    (await run(`menu/imports/${added.data.import.id}/unload`, "POST", {}))
      .status,
    200,
  );
  const result = await run(
    `menu/imports/${added.data.import.id}/restore`,
    "POST",
    {},
  );
  assert.equal(result.status, 200);
  const restored = (await run("bootstrap")).data.catalog.filter((item: any) =>
    added.data.items.some((old: any) => old.id === item.id),
  );
  assert.equal(restored.length, 2);
  assert.ok(restored.every((item: any) => item.name === "Original A"));
});
