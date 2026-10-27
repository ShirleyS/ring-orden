/** Literal/local destination guard. Production egress must also prevent DNS rebinding. */
export function validateModelEndpoint(
  endpoint: string,
  allowLocalhost = false,
): URL {
  if (endpoint.length > 2048) throw new Error("Model endpoint is too long");
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "Model endpoint must not contain credentials, query or fragment",
    );
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const loopback =
    host === "localhost" || host === "::1" || /^127\./.test(host);
  if (allowLocalhost && loopback && ["http:", "https:"].includes(url.protocol))
    return url;
  if (url.protocol !== "https:")
    throw new Error(
      "Use HTTPS, or explicitly allow a local development endpoint",
    );
  const ip = host.split(".").map(Number);
  const privateV4 =
    ip.length === 4 &&
    ip.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (ip[0] === 0 ||
      ip[0] === 10 ||
      ip[0] === 127 ||
      ip[0] >= 224 ||
      (ip[0] === 169 && ip[1] === 254) ||
      (ip[0] === 172 && ip[1] >= 16 && ip[1] <= 31) ||
      (ip[0] === 192 && ip[1] === 168) ||
      (ip[0] === 100 && ip[1] >= 64 && ip[1] <= 127));
  const privateV6 =
    host.includes(":") &&
    (/^(::|fc|fd|fe[89ab])/i.test(host) || host.startsWith("::ffff:"));
  if (
    loopback ||
    privateV4 ||
    privateV6 ||
    !host.includes(".") ||
    /\.(?:localhost|local|internal|lan|home|test)$/.test(host)
  )
    throw new Error(
      "Private/local model destinations are disabled in hosted mode",
    );
  return url;
}
export async function readModelJSON(
  response: Response,
  maxBytes = 1048576,
): Promise<unknown> {
  if (Number(response.headers.get("Content-Length") ?? 0) > maxBytes)
    throw new Error("Model JSON response exceeds size limit");
  if (!response.body) throw new Error("Model JSON response is empty");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error("Model JSON response exceeds size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Model provider returned invalid JSON response");
  }
}
