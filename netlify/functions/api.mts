import type { Config, Context } from "@netlify/functions";
import { getDatabase } from "@netlify/database";
import { handleRequest } from "../../apps/api/src/server.ts";
import type { RuntimeEnv } from "../../apps/api/src/auth.ts";
import { NetlifyRepository } from "../../apps/api/src/netlify-repository.ts";
import { adaptNetlifyRequest } from "../adapter.ts";
export default async function api(
  request: Request,
  context: Context,
): Promise<Response> {
  const { request: secured, env } = adaptNetlifyRequest(
    request,
    context,
    process.env as RuntimeEnv,
  );
  if (env.SUPABASE_URL || env.SUPABASE_SERVER_SECRET)
    return handleRequest(secured, env);
  try {
    const database = getDatabase();
    const repository = new NetlifyRepository(
      async (text, params) =>
        (await database.sql.unsafe(text, params ?? [])) as Record<
          string,
          unknown
        >[],
    );
    return await handleRequest(
      secured,
      { ...env, NETLIFY_DATABASE: "true" },
      repository,
    );
  } catch {
    return Response.json(
      {
        error:
          "The Netlify database is not ready. Check the database migration and deployment status.",
      },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
export const config: Config = { path: "/api/*" };
