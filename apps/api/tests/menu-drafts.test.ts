import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
const item = {
  name: "Persisted Latte",
  price: 78,
  category: "Coffee",
  description: "Milk",
  available: true,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
  "base64",
);
const env = { TRUST_SITES_HEADERS: "true", FIRECRAWL_API_KEY: "test-key" };
const headers = { "oai-authenticated-user-id": "draft-owner" };
async function request(
  repo: MemoryRepository,
  path: string,
  body?: unknown,
  owner = "draft-owner",
) {
  return handleRequest(
    new Request("https://ring.test/api/" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        ...headers,
        "oai-authenticated-user-id": owner,
        ...(body instanceof FormData
          ? {}
          : { "Content-Type": "application/json" }),
      },
      ...(body === undefined
        ? {}
        : { body: body instanceof FormData ? body : JSON.stringify(body) }),
    }),
    env,
    repo,
  );
}
function photo() {
  const form = new FormData();
  form.set("file", new Blob([png], { type: "image/png" }), "original-menu.png");
  return form;
}
function mock() {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json({
      success: true,
      data: { json: { currency: "MXN", items: [item] } },
    });
  return () => {
    globalThis.fetch = original;
  };
}
test("extracted results survive a fresh request without publishing and remain workspace scoped", async () => {
  const restore = mock();
  try {
    const repo = new MemoryRepository();
    const response = await request(repo, "menu/image/preview", photo());
    assert.equal(response.status, 200);
    const extracted = (await response.json()) as any;
    assert.ok(extracted.id);
    const resumed = await request(repo, "menu/image/drafts");
    const drafts = ((await resumed.json()) as any).drafts;
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0].items[0].name, item.name);
    assert.equal(drafts[0].label, "original-menu.png");
    const boot = await request(repo, "bootstrap");
    assert.equal(
      ((await boot.json()) as any).catalog.some(
        (i: any) => i.name === item.name,
      ),
      false,
    );
    assert.deepEqual(
      (
        (await (
          await request(repo, "menu/image/drafts", undefined, "someone-else")
        ).json()) as any
      ).drafts,
      [],
    );
    const imported = await request(repo, "menu/import", {
      items: [item],
      source: "photo",
      draft_id: extracted.id,
    });
    assert.equal(imported.status, 201);
    assert.equal(
      ((await (await request(repo, "menu/image/drafts")).json()) as any).drafts
        .length,
      0,
    );
    const stored = [...repo.rows.values()].find((r) =>
      r.state.menu_drafts?.some((d) => d.id === extracted.id),
    )!.state;
    assert.equal(stored.menu_drafts![0].status, "imported");
    assert.equal(stored.menu_drafts![0].items[0].name, item.name);
  } finally {
    restore();
  }
});
test("database write failure cannot report a saved extraction", async () => {
  const restore = mock();
  try {
    const repo = new MemoryRepository();
    repo.save = async () => false;
    const response = await request(repo, "menu/image/preview", photo());
    assert.equal(response.status, 409);
  } finally {
    restore();
  }
});
test("an extraction rebases on updates made while Firecrawl is running", async () => {
  const restore = mock();
  try {
    const repo = new MemoryRepository();
    await request(repo, "bootstrap");
    globalThis.fetch = async () => {
      const row = [...repo.rows.values()][0];
      row.revision++;
      row.state.merchant.name = "Concurrent change";
      return Response.json({
        success: true,
        data: { json: { currency: "MXN", items: [item] } },
      });
    };
    assert.equal(
      (await request(repo, "menu/image/preview", photo())).status,
      200,
    );
    assert.equal(
      [...repo.rows.values()][0].state.merchant.name,
      "Concurrent change",
    );
  } finally {
    restore();
  }
});
