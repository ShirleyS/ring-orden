import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

// Execute the real browser modules with build-time public configuration replaced.
// Only browser storage and the remote fetch boundary are test doubles.
async function clientFixture(
  run: (
    api: (path: string) => Promise<unknown>,
    calls: string[],
  ) => Promise<void>,
  mode: "mojo" | "supabase" | "forbidden",
) {
  const previousFetch = globalThis.fetch;
  const storageDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage",
  );
  const values = new Map([
    [
      "ring-orden-supabase-session",
      JSON.stringify({
        access_token: "old-token",
        refresh_token: "old-refresh",
        expires_at: 1,
      }),
    ],
  ]);
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  });
  const calls: string[] = [];
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    if (url.startsWith("https://database.supabase.co/")) {
      if (mode === "mojo") throw new Error("Supabase temporarily unavailable");
      return Response.json({
        access_token: "fresh-token",
        refresh_token: "fresh-refresh",
        expires_in: 3600,
      });
    }
    assert.equal(url, "/api/bootstrap");
    if (mode === "mojo")
      return Response.json({ user: { provider: "mojoauth" } });
    if (mode === "forbidden")
      return Response.json(
        { error: "You do not have access to this merchant workspace." },
        { status: 403 },
      );
    return new Headers(init?.headers).get("Authorization") ===
      "Bearer fresh-token"
      ? Response.json({ user: { provider: "supabase" } })
      : Response.json({ error: "Please sign in." }, { status: 401 });
  };
  try {
    const compile = (source: string) =>
      ts.transpileModule(source, {
        compilerOptions: {
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
      }).outputText;
    const dataModule = (source: string) =>
      "data:text/javascript;base64," +
      Buffer.from(source + "\n// " + crypto.randomUUID()).toString("base64");
    const auth = compile(
      (
        await readFile(
          new URL("../../merchant-dashboard/supabase-auth.ts", import.meta.url),
          "utf8",
        )
      ).replaceAll(
        "import.meta.env",
        '({ VITE_SUPABASE_URL: "https://database.supabase.co", VITE_SUPABASE_PUBLISHABLE_KEY: "public-key" })',
      ),
    );
    const code = compile(
      await readFile(
        new URL("../../merchant-dashboard/types.ts", import.meta.url),
        "utf8",
      ),
    ).replace('"./supabase-auth"', JSON.stringify(dataModule(auth)));
    const module = await import(dataModule(code));
    await run(module.api, calls);
  } finally {
    globalThis.fetch = previousFetch;
    if (storageDescriptor)
      Object.defineProperty(globalThis, "localStorage", storageDescriptor);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}

test("a valid MojoAuth cookie reaches the workspace despite stale Supabase credentials and outage", async () => {
  await clientFixture(async (api, calls) => {
    assert.deepEqual(await api("/bootstrap"), {
      user: { provider: "mojoauth" },
    });
    assert.deepEqual(calls, ["/api/bootstrap"]);
  }, "mojo");
});

test("an anonymous cookie request can fall back to the existing Supabase login", async () => {
  await clientFixture(async (api, calls) => {
    assert.deepEqual(await api("/bootstrap"), {
      user: { provider: "supabase" },
    });
    assert.deepEqual(calls, [
      "/api/bootstrap",
      "https://database.supabase.co/auth/v1/token?grant_type=refresh_token",
      "/api/bootstrap",
    ]);
  }, "supabase");
});

test("a forbidden workspace does not silently switch to another provider identity", async () => {
  await clientFixture(async (api, calls) => {
    await assert.rejects(api("/bootstrap"), /do not have access/);
    assert.deepEqual(calls, ["/api/bootstrap"]);
  }, "forbidden");
});
