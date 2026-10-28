import test from "node:test";
import assert from "node:assert/strict";
import { handleRequest } from "../src/server.ts";
import { MemoryRepository } from "../src/repository.ts";
const sample = {
  name: "Photo Latte",
  price: 78,
  category: "Coffee",
  description: "Espresso with milk",
  available: true,
};
function call(
  repo: MemoryRepository,
  path: string,
  body: unknown = {},
  requestId?: string,
) {
  return handleRequest(
    new Request("https://ring.test/api/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "oai-authenticated-user-id": "photo-owner",
        ...(requestId ? { "Idempotency-Key": requestId } : {}),
      },
      body: JSON.stringify(body),
    }),
    { TRUST_SITES_HEADERS: "true" },
    repo,
  );
}
test("reviewed menu products are imported atomically and immediately appear in the catalog", async () => {
  const repo = new MemoryRepository();
  const result = await call(repo, "menu/import", { items: [sample] });
  assert.equal(result.status, 201);
  const boot = await handleRequest(
    new Request("https://ring.test/api/bootstrap", {
      headers: { "oai-authenticated-user-id": "photo-owner" },
    }),
    { TRUST_SITES_HEADERS: "true" },
    repo,
  );
  const data = (await boot.json()) as any;
  assert.equal(
    data.catalog.find((i: any) => i.name === sample.name)?.price,
    78,
  );
});
test("a duplicate product rejects the whole batch without adding earlier rows", async () => {
  const repo = new MemoryRepository();
  await call(repo, "menu/import", { items: [sample] });
  const result = await call(repo, "menu/import", {
    items: [{ ...sample, name: "Should not be added" }, sample],
  });
  assert.equal(result.status, 409);
  const boot = await handleRequest(
    new Request("https://ring.test/api/bootstrap", {
      headers: { "oai-authenticated-user-id": "photo-owner" },
    }),
    { TRUST_SITES_HEADERS: "true" },
    repo,
  );
  assert.equal(
    ((await boot.json()) as any).catalog.some(
      (i: any) => i.name === "Should not be added",
    ),
    false,
  );
});
test("missing photo prices cannot become free catalog products", async () => {
  const result = await call(new MemoryRepository(), "menu/import", {
    items: [{ ...sample, price: null }],
  });
  assert.equal(result.status, 422);
});
test("retrying a confirmed import request does not create duplicate products", async () => {
  const repo = new MemoryRepository();
  const one = await call(
    repo,
    "menu/import",
    { items: [sample] },
    "photo-import-1",
  );
  const two = await call(
    repo,
    "menu/import",
    { items: [sample] },
    "photo-import-1",
  );
  assert.equal(one.status, 201);
  assert.equal(two.status, 200);
  assert.deepEqual(await one.json(), await two.json());
});

import { extractMenuPhoto, normalizeMenuPhoto } from "../src/menu-image.ts";
const tinyPNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  ),
);
function photoRequest(bytes: Uint8Array = tinyPNG, type = "image/png") {
  const body = new FormData();
  body.set("file", new Blob([Uint8Array.from(bytes)], { type }), "menu.png");
  return new Request("https://ring.test/api/menu/image/preview", {
    method: "POST",
    body,
  });
}
test("photo extraction forwards one private PDF and returns editable products without publishing them", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async (input, options) => {
      assert.equal(String(input), "https://api.firecrawl.dev/v2/parse");
      assert.equal(
        new Headers(options?.headers).get("Authorization"),
        "Bearer server-only-key",
      );
      const body = options!.body as FormData;
      const file = body.get("file") as File;
      assert.equal(file.type, "application/pdf");
      assert.match(
        Buffer.from(await file.arrayBuffer()).toString("ascii", 0, 5),
        /%PDF/,
      );
      const extractionOptions = JSON.parse(body.get("options") as string);
      assert.equal(extractionOptions.parsers[0].mode, "ocr");
      return Response.json({
        success: true,
        data: {
          json: {
            currency: "MXN",
            items: [
              sample,
              {
                name: "Unclear pastry",
                price: null,
                category: "Bakery",
                description: "",
              },
            ],
          },
        },
      });
    };
    const result = await extractMenuPhoto(
      photoRequest(),
      "server-only-key",
      "MXN",
    );
    assert.equal(result.items[0].price, 78);
    assert.equal(result.items[1].price, null);
    assert.ok(result.warnings.some((w) => /unclear/i.test(w)));
  } finally {
    globalThis.fetch = original;
  }
});
test("unknown or foreign menu currency is never silently converted", () => {
  assert.throws(
    () => normalizeMenuPhoto({ currency: "USD", items: [sample] }, "MXN"),
    /USD/,
  );
  const result = normalizeMenuPhoto({ currency: null, items: [sample] }, "MXN");
  assert.ok(result.warnings.some((w) => /Confirm.*MXN/.test(w)));
});
test("fake photo bytes are rejected even with an image filename and MIME type", async () => {
  await assert.rejects(
    extractMenuPhoto(
      photoRequest(new TextEncoder().encode("<script>not a photo</script>")),
      "key",
    ),
    /JPG or PNG/,
  );
});
test("oversized and unconfigured uploads fail before calling Firecrawl", async () => {
  await assert.rejects(extractMenuPhoto(photoRequest(), ""), /not connected/i);
  const request = new Request("https://ring.test/api/menu/image/preview", {
    method: "POST",
    headers: { "content-length": String(4 * 1024 * 1024) },
  });
  await assert.rejects(extractMenuPhoto(request, "key"), /smaller/i);
});
test("upstream credit errors show a useful error without exposing the provider key", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      Response.json({ error: "secret provider detail" }, { status: 402 });
    await assert.rejects(
      extractMenuPhoto(photoRequest(), "never-expose-this-key"),
      /credits have run out/i,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("an anonymous image upload is rejected before extraction", async () => {
  const result = await handleRequest(
    photoRequest(),
    { FIRECRAWL_API_KEY: "key" },
    new MemoryRepository(),
  );
  assert.equal(result.status, 401);
});

test("an OCR zero price requires human confirmation instead of defaulting to a free product", () => {
  const result = normalizeMenuPhoto(
    { currency: "MXN", items: [{ ...sample, price: 0 }] },
    "MXN",
  );
  assert.equal(result.items[0].price, null);
});
