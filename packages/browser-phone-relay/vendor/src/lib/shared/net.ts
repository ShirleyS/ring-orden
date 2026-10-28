// Pure, runtime-agnostic helpers for webhook URL safety (SSRF defense).
// Shared by the server API and the unit tests.

export type UrlCheck = { ok: true; url: URL; fingerprint: string } | { ok: false; reason: string };

const BLOCKED_HOST_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home", ".corp", ".intranet", ".arpa"];

type V4 = [number, number, number, number];
function parseIPv4(s: string): V4 | null {
  const m = s.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.every((n) => n >= 0 && n <= 255) ? (p as V4) : null;
}

export function isPrivateIPv4(ip: string): boolean {
  const p = parseIPv4(ip);
  if (!p) return true; // unparseable → treat as unsafe
  const [a, b, c] = p;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true;
  if (a === 192 && b === 88 && c === 99) return true;
  if (a === 198 && (b === 18 || b === 19)) return true;
  if (a === 198 && b === 51 && c === 100) return true;
  if (a === 203 && b === 0 && c === 113) return true;
  if (a >= 224) return true; // multicast, reserved, broadcast
  return false;
}

function expandIPv6(ip: string): [number, number, number, number, number, number, number, number] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "");
  const zone = s.indexOf("%");
  if (zone >= 0) s = s.slice(0, zone);
  // embedded IPv4 tail
  const v4m = s.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4m) {
    const v4 = parseIPv4(v4m[2]!);
    if (!v4) return null;
    s = v4m[1]! + ((v4[0] << 8) | v4[1]).toString(16) + ":" + ((v4[2] << 8) | v4[3]).toString(16);
  }
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(":") : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(":") : [];
  const fill = parts.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0) return null;
  const all = [...head, ...Array(fill).fill("0"), ...tail];
  if (all.length !== 8) return null;
  const nums = all.map((h) => (/^[0-9a-f]{1,4}$/.test(h) ? parseInt(h, 16) : NaN));
  return nums.some(Number.isNaN) ? null : (nums as [number, number, number, number, number, number, number, number]);
}

export function isPrivateIPv6(ip: string): boolean {
  const w = expandIPv6(ip);
  if (!w) return true;
  const v4 = (hi: number, lo: number) => `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  if (w.every((x) => x === 0)) return true; // ::
  if (w.slice(0, 7).every((x) => x === 0) && w[7] === 1) return true; // ::1
  if (w.slice(0, 5).every((x) => x === 0) && w[5] === 0xffff) return isPrivateIPv4(v4(w[6], w[7])); // mapped
  if (w.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible (deprecated)
  if (w[0] === 0x64 && w[1] === 0xff9b) return isPrivateIPv4(v4(w[6], w[7])); // NAT64
  if ((w[0] & 0xfe00) === 0xfc00) return true; // ULA
  if ((w[0] & 0xffc0) === 0xfe80) return true; // link-local
  if ((w[0] & 0xffc0) === 0xfec0) return true; // site-local
  if ((w[0] & 0xff00) === 0xff00) return true; // multicast
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // documentation
  if (w[0] === 0x2001 && w[1] === 0) return true; // Teredo
  if (w[0] === 0x2002) return true; // 6to4
  if ((w[0] & 0xe000) !== 0x2000) return true; // only global unicast 2000::/3
  return false;
}

export function isIpLiteral(host: string): "v4" | "v6" | null {
  if (parseIPv4(host)) return "v4";
  if (host.startsWith("[") || host.includes(":")) return "v6";
  // Numeric-only hosts like "2130706433" or "0x7f.1" are IPv4 tricks
  if (/^[0-9.]+$/.test(host) || /^0x/i.test(host)) return "v4";
  return null;
}

export function isPrivateAddress(ip: string): boolean {
  const kind = isIpLiteral(ip);
  if (kind === "v4") return isPrivateIPv4(ip);
  if (kind === "v6") return isPrivateIPv6(ip);
  return true;
}

/** Syntactic checks + normalized fingerprint. DNS resolution happens separately. */
export function checkWebhookUrl(raw: string, opts: { allowInsecure?: boolean } = {}): UrlCheck {
  if (typeof raw !== "string" || raw.length > 2048) return { ok: false, reason: "invalid_url" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "invalid_url" };
  }
  if (url.protocol !== "https:" && !(opts.allowInsecure && url.protocol === "http:"))
    return { ok: false, reason: "https_required" };
  if (url.username || url.password) return { ok: false, reason: "credentials_in_url" };
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!opts.allowInsecure) {
    const lit = isIpLiteral(host);
    if (lit && isPrivateAddress(host)) return { ok: false, reason: "private_address" };
    if (!lit) {
      if (!host.includes(".") || host === "localhost") return { ok: false, reason: "private_address" };
      if (BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) return { ok: false, reason: "private_address" };
    }
  }
  url.hash = "";
  return { ok: true, url, fingerprint: webhookFingerprint(url) };
}

/** Quota key: scheme + host + port + path, query/fragment/trailing slash ignored. */
export function webhookFingerprint(url: URL): string {
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  const port = url.port && !((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) ? `:${url.port}` : "";
  const path = url.pathname.replace(/\/+$/, "") || "/";
  return `${url.protocol}//${host}${port}${path}`;
}

export type Resolver = (host: string) => Promise<string[]>;

/** Full check: syntax + every resolved A/AAAA record must be public. */
export async function assertPublicWebhook(
  raw: string,
  resolve: Resolver,
  opts: { allowInsecure?: boolean } = {},
): Promise<UrlCheck> {
  const c = checkWebhookUrl(raw, opts);
  if (!c.ok || opts.allowInsecure) return c;
  const host = c.url.hostname.replace(/^\[|\]$/g, "");
  if (isIpLiteral(host)) return c;
  let ips: string[];
  try {
    ips = await resolve(host);
  } catch {
    return { ok: false, reason: "dns_failed" };
  }
  if (ips.length === 0) return { ok: false, reason: "dns_no_records" };
  if (ips.some((ip) => isPrivateAddress(ip))) return { ok: false, reason: "private_address" };
  return c;
}

/** UTC day helpers used by quota display and tests. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}
export function nextUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1));
}
