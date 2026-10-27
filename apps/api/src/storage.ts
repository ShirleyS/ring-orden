import type { RuntimeEnv } from "./auth.ts";
import { HttpError } from "./auth.ts";
import type { Repository } from "./types.ts";
import { D1Repository } from "./repository.ts";
import { SupabaseRepository } from "./supabase-repository.ts";
export function repositoryFor(env: RuntimeEnv): Repository {
  if (env.SUPABASE_URL || env.SUPABASE_SERVER_SECRET) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVER_SECRET)
      throw new HttpError(
        503,
        "Set both SUPABASE_URL and SUPABASE_SERVER_SECRET before selecting Supabase storage.",
      );
    return new SupabaseRepository({
      url: env.SUPABASE_URL,
      serverSecret: env.SUPABASE_SERVER_SECRET,
    });
  }
  if (env.DB) return new D1Repository(env.DB);
  throw new HttpError(
    503,
    "Database is not ready. Apply the included database migration first.",
  );
}
export function storageStatus(env: RuntimeEnv) {
  return {
    provider:
      env.SUPABASE_URL && env.SUPABASE_SERVER_SECRET
        ? "supabase"
        : env.NETLIFY_DATABASE === "true"
          ? "netlify-postgres"
          : "d1",
    status: "connected",
    scoped: true,
  };
}
