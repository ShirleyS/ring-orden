import { buildElevenLabsToolConfigs } from "../../../prompts/elevenlabs-tool-configs.mjs";
import { HttpError } from "./auth.ts";
import type { RuntimeEnv } from "./auth.ts";

type Tool = {
  id: string;
  tool_config: {
    name: string;
    api_schema?: { url?: string; request_headers?: Record<string, unknown> };
  };
};
type Agent = {
  conversation_config: {
    agent: {
      prompt: { tool_ids?: string[]; [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
};

/** Owner-only setup: never retrieve credential values or delete shared tools. */
export async function configureElevenLabsTools(
  env: RuntimeEnv,
  merchantId: string,
  fetcher: typeof fetch = fetch,
) {
  if (env.AGENT_MERCHANT_ID !== merchantId)
    throw new HttpError(
      403,
      "This voice agent is not bound to your merchant workspace.",
    );
  const apiKey = env.ELEVENLABS_API_KEY;
  const agentId = env.ELEVENLABS_AGENT_ID;
  const secretId = String(env.ELEVENLABS_TOOL_SECRET_ID ?? "");
  const apiOrigin = String(env.ELEVENLABS_TOOLS_API_ORIGIN ?? "");
  if (!apiKey || !agentId || !secretId || !apiOrigin)
    throw new HttpError(
      503,
      "Complete the ElevenLabs tool configuration on the server first.",
    );
  const desired = buildElevenLabsToolConfigs({ apiOrigin, secretId });
  const branch = env.ELEVENLABS_BRANCH_ID
    ? `?branch_id=${encodeURIComponent(String(env.ELEVENLABS_BRANCH_ID))}`
    : "";
  const agentPath = `/agents/${encodeURIComponent(agentId)}${branch}`;
  const api = async (
    path: string,
    method = "GET",
    body?: unknown,
  ): Promise<any> => {
    let response: Response;
    try {
      response = await fetcher(`https://api.elevenlabs.io/v1/convai${path}`, {
        method,
        headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(12000),
      });
    } catch {
      throw new HttpError(
        502,
        "ElevenLabs setup timed out. Retry to reuse tools already created.",
      );
    }
    if (!response.ok) {
      const stage = path.startsWith("/agents/")
        ? "agent configuration"
        : method === "POST"
          ? "tool creation"
          : "tool inventory";
      // Only error codes/schema locations are returned; never echo provider inputs or headers.
      const error = (await response.json().catch(() => ({}))) as any;
      const detail = error.detail;
      const code =
        typeof detail?.status === "string" &&
        /^[a-z_]{1,80}$/.test(detail.status)
          ? `; ${detail.status}`
          : "";
      const fields = Array.isArray(detail)
        ? detail
            .slice(0, 3)
            .map((item: any) =>
              Array.isArray(item.loc)
                ? item.loc
                    .filter(
                      (part: unknown) =>
                        typeof part === "string" && /^[a-z_]{1,80}$/.test(part),
                    )
                    .join(".")
                : "",
            )
            .filter(Boolean)
            .join(", ")
        : "";
      throw new HttpError(
        502,
        `ElevenLabs ${stage} failed (${response.status}${code}${fields ? `; fields: ${fields}` : ""}). The agent was not verified.`,
      );
    }
    return response.json();
  };
  const before = (await api(agentPath)) as Agent;
  if (!before.conversation_config?.agent?.prompt)
    throw new HttpError(
      502,
      "ElevenLabs returned an unsupported agent configuration.",
    );
  const tools: Tool[] = [];
  let cursor = "";
  for (let page = 0; page < 20; page++) {
    const listed = await api(
      `/tools?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    if (!Array.isArray(listed.tools))
      throw new HttpError(502, "ElevenLabs returned an invalid tool list.");
    tools.push(...listed.tools);
    if (!listed.has_more) break;
    if (!listed.next_cursor || page === 19)
      throw new HttpError(
        502,
        "ElevenLabs tool inventory is incomplete. No agent changes were published.",
      );
    cursor = listed.next_cursor;
  }
  const selected: string[] = [];
  let created = 0;
  for (const config of desired) {
    const existing = tools.find(
      (tool) =>
        tool.tool_config.name === config.name &&
        tool.tool_config.api_schema?.url === config.api_schema.url &&
        JSON.stringify(
          tool.tool_config.api_schema.request_headers?.Authorization,
        ) === JSON.stringify({ secret_id: secretId }),
    );
    if (existing) selected.push(existing.id);
    else {
      const tool = await api("/tools", "POST", { tool_config: config });
      if (typeof tool.id !== "string")
        throw new HttpError(
          502,
          "ElevenLabs did not confirm tool creation. The agent was not updated.",
        );
      selected.push(tool.id);
      created++;
    }
  }
  const managedNames = new Set(desired.map((tool) => tool.name));
  const oldIds = before.conversation_config.agent.prompt.tool_ids ?? [];
  const retained = oldIds.filter((id) => {
    const old = tools.find((tool) => tool.id === id);
    // Replace only our canonical tool names/routes; preserve unrelated integrations.
    return (
      !old ||
      !managedNames.has(old.tool_config.name) ||
      !old.tool_config.api_schema?.url?.endsWith(
        `/api/tools/${old.tool_config.name}`,
      )
    );
  });
  const attached = [...new Set([...retained, ...selected])];
  await api(agentPath, "PATCH", {
    conversation_config: {
      agent: {
        prompt: { tool_ids: attached },
      },
    },
  });
  const verified = (await api(agentPath)) as Agent;
  if (
    !selected.every((id) =>
      verified.conversation_config?.agent?.prompt?.tool_ids?.includes(id),
    )
  )
    throw new HttpError(
      502,
      "ElevenLabs saved a configuration but did not confirm all tool attachments.",
    );
  const preserved = (config: Agent["conversation_config"]) => {
    const copy = structuredClone(config);
    delete copy.agent.prompt.tool_ids;
    // GET expands referenced tools into this derived array after publication.
    const inline = copy.agent.prompt.tools;
    if (Array.isArray(inline))
      copy.agent.prompt.tools = inline.filter(
        (tool) => tool?.type !== "webhook" || !managedNames.has(tool?.name),
      );
    const sorted = (value: any): any =>
      Array.isArray(value)
        ? value.map(sorted)
        : value && typeof value === "object"
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([key, item]) => [key, sorted(item)]),
            )
          : value;
    return JSON.stringify(sorted(copy));
  };
  if (
    preserved(before.conversation_config) !==
    preserved(verified.conversation_config)
  )
    throw new HttpError(
      502,
      "ElevenLabs changed other conversation settings during tool setup. Review the published version before using the agent.",
    );
  return {
    provider: "elevenlabs",
    status: "connected",
    verified: true,
    tools_attached: selected.length,
    tools_created: created,
    message: `${selected.length} RingOrden tools attached and verified. Conversation instructions and unrelated tools were preserved.`,
  };
}
