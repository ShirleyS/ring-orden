import { HttpError, type RuntimeEnv } from "./auth.ts";

const collections = [
  [
    "merchants",
    "SELECT id,owner_user_id,name,created_at FROM merchants ORDER BY id",
  ],
  [
    "tenant_state",
    "SELECT merchant_id,revision,payload,updated_at FROM tenant_state ORDER BY merchant_id",
  ],
  [
    "merchant_memberships",
    "SELECT id,merchant_id,user_subject,email,name,role,created_at FROM merchant_memberships ORDER BY id",
  ],
  [
    "merchant_invitations",
    "SELECT id,merchant_id,token_hash,email,name,role,expires_at,created_at,accepted_by,accepted_at FROM merchant_invitations ORDER BY id",
  ],
  [
    "integration_events",
    "SELECT id,merchant_id,provider,event_type,created_at FROM integration_events ORDER BY id",
  ],
] as const;

/**
 * Opt-in, one-time copy of the bound Sites D1 store before Supabase is selected.
 * Every source operation is a SELECT; the destination RPC commits all rows and
 * its marker atomically. Drain older D1 writers before activating this cutover.
 */
export async function prepareSupabaseMigration(
  env: RuntimeEnv,
  request: typeof fetch = fetch,
): Promise<void> {
  if (env.SUPABASE_MIGRATE_D1 !== "true") return;
  try {
    if (!env.DB || !env.SUPABASE_URL || !env.SUPABASE_SERVER_SECRET)
      throw new Error("Incomplete cutover configuration");
    const url = new URL(env.SUPABASE_URL);
    if (url.protocol !== "https:" || url.username || url.password)
      throw new Error("Invalid database origin");
    const secret = env.SUPABASE_SERVER_SECRET;
    const rpc = async (operation: string, body: Record<string, unknown>) => {
      const response = await request(url.origin + "/rest/v1/rpc/" + operation, {
        method: "POST",
        redirect: "error",
        headers: {
          apikey: secret,
          ...(secret.startsWith("sb_secret_")
            ? {}
            : { Authorization: "Bearer " + secret }),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("Cutover RPC unavailable");
      return response.json() as Promise<unknown>;
    };
    const completed = await rpc("ring_d1_cutover_status", {});
    if (completed === true) return;
    if (completed !== false) throw new Error("Invalid cutover status");

    const results = await env.DB.batch<Record<string, unknown>>(
      collections.map(([, sql]) => env.DB!.prepare(sql)),
    );
    if (
      results.length !== collections.length ||
      results.some(
        (result) => result.success !== true || !Array.isArray(result.results),
      )
    )
      throw new Error("Incomplete source snapshot");

    const snapshot: Record<string, unknown> = { source: "sites-d1-v1" };
    for (let i = 0; i < collections.length; i++)
      snapshot[collections[i][0]] = results[i].results;
    snapshot.tenant_state = results[1].results.map((row) => {
      const payload =
        typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      if (
        !payload ||
        typeof payload !== "object" ||
        !("merchant" in payload) ||
        !payload.merchant ||
        typeof payload.merchant !== "object" ||
        !("id" in payload.merchant) ||
        payload.merchant.id !== row.merchant_id ||
        !Number.isSafeInteger(row.revision) ||
        Number(row.revision) < 0
      )
        throw new Error("Invalid source state");
      return { ...row, payload };
    });
    const imported = await rpc("ring_import_d1_snapshot", {
      p_snapshot: snapshot,
    });
    if (
      !imported ||
      typeof imported !== "object" ||
      !("completed" in imported) ||
      imported.completed !== true
    )
      throw new Error("Cutover was not completed");
  } catch {
    // Remote error bodies and source records can contain credentials or customer
    // data. Keep them out of application responses and logs.
    throw new HttpError(
      503,
      "Supabase database cutover is not ready. Check the migration and retry; the original database is preserved.",
    );
  }
}
