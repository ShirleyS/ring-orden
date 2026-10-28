import { spawnSync } from "node:child_process";
import { configureElevenLabsTools } from "../apps/api/src/elevenlabs-setup.ts";

// Uses the CLI's existing login. Never reads its keyring or credential files.
const entry = process.env.ELEVENLABS_CLI_ENTRY;
const command = entry ? process.execPath : "elevenlabs";
const baseArgs = entry ? [entry] : [];
function cli(args, body) {
  const result = spawnSync(
    command,
    [...baseArgs, ...args, ...(body === undefined ? [] : ["--json", "-"])],
    {
      input: body === undefined ? undefined : JSON.stringify(body),
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (result.status !== 0) {
    let error;
    try {
      error = JSON.parse(result.stdout).error;
    } catch {
      throw new Error("ElevenLabs CLI failed. Check the existing saved login.");
    }
    const code = Number(error?.code);
    console.error(
      JSON.stringify({
        code,
        reason: error?.reason,
        message: String(error?.message ?? "")
          .slice(0, 1000)
          .replace(/sk_[A-Za-z0-9_-]+/g, "[redacted]"),
      }),
    );
    return new Response(
      JSON.stringify({
        detail: error?.details?.detail ?? {
          status: String(error?.reason ?? "cli_error"),
        },
      }),
      { status: code >= 400 && code <= 599 ? code : 502 },
    );
  }
  return new Response(result.stdout, {
    headers: { "Content-Type": "application/json" },
  });
}
const adapter = async (url, init) => {
  const parsed = new URL(String(url));
  const body = init?.body ? JSON.parse(String(init.body)) : undefined;
  let args;
  if (parsed.pathname.includes("/agents/")) {
    const id = parsed.pathname.split("/").at(-1);
    args = [
      "agents",
      init?.method === "PATCH" ? "update" : "get",
      "--agent-id",
      id,
    ];
    if (parsed.searchParams.has("branch_id"))
      args.push("--branch-id", parsed.searchParams.get("branch_id"));
    args.push("--query", "{conversation_config:conversation_config}");
  } else if (init?.method === "POST")
    args = ["agents", "tools", "create", "--query", "{id:id}"];
  else {
    args = [
      "agents",
      "tools",
      "list",
      "--page-size",
      "100",
      "--query",
      "{tools:tools[].{id:id,tool_config:{name:tool_config.name,api_schema:{url:tool_config.api_schema.url,request_headers:{Authorization:{secret_id:tool_config.api_schema.request_headers.Authorization.secret_id}}}}},has_more:has_more,next_cursor:next_cursor}",
    ];
    if (parsed.searchParams.has("cursor"))
      args.push("--cursor", parsed.searchParams.get("cursor"));
  }
  return cli(args, body);
};
const result = await configureElevenLabsTools(
  {
    ...process.env,
    ELEVENLABS_API_KEY: "authenticated-through-existing-cli",
  },
  process.env.AGENT_MERCHANT_ID,
  adapter,
);
console.log(JSON.stringify(result, null, 2));
