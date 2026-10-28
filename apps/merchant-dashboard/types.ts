import { supabaseAccessToken } from "./supabase-auth";

export type Obj = Record<string, any>;
export type Workspace = {
  merchant: Obj;
  catalog: Obj[];
  orders: Obj[];
  memories: Obj[];
  calls: Obj[];
  escalations: Obj[];
  events: Obj[];
  settings: Obj;
  integrations: Obj[];
  team: Obj[];
  mode: string;
  user: Obj;
};
export const money = (v: number = 0, currency = "MXN") =>
  new Intl.NumberFormat("en-MX", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(v);
export const label = (s: string = "") =>
  s
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
export const time = (s: string) =>
  s
    ? new Date(s).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        timeZone: "America/Mexico_City",
      })
    : "—";
export const api = async <T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> => {
  const send = (token?: string) =>
    fetch("/api" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      ...(signal ? { signal } : {}),
    });
  // A server session must not depend on another provider's refresh availability.
  let r = await send();
  if (r.status === 401) {
    const token = await supabaseAccessToken();
    if (token) r = await send(token);
  }
  const d: any = await r.json();
  if (!r.ok)
    throw new Error(
      d.error?.message ||
        d.error ||
        d.message ||
        "Something went wrong. Please try again.",
    );
  return d;
};
