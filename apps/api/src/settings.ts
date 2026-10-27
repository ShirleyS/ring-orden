import { z } from "zod";
const phone = z
  .string()
  .max(30)
  .refine(
    (s) => s === "" || /^\+\d{8,15}$/.test(s),
    "Use an international phone number, for example +525555123456.",
  );
const timezone = z
  .string()
  .max(100)
  .refine((s) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: s });
      return true;
    } catch {
      return false;
    }
  }, "Use a valid time zone.");
const schedules = z.record(
  z.object({
    enabled: z.boolean(),
    open: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    close: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  }),
);
export const SettingsSchemas: Record<string, z.ZodTypeAny> = {
  business: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      business_type: z.string().max(100).optional(),
      address: z.string().max(500).optional(),
      timezone: timezone.optional(),
      currency: z.literal("MXN").optional(),
      language: z.enum(["es-MX", "en-US", "bilingual"]).optional(),
      hours: z.string().max(1000).optional(),
      schedule: schedules.optional(),
      special_closures: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .max(100)
        .optional(),
      tax_rate: z.number().finite().min(0).max(1).optional(),
      minimum_order: z.number().finite().min(0).max(100000).optional(),
      maximum_order: z.number().finite().min(1).max(100000).optional(),
      maximum_quantity: z.number().int().min(1).max(50).optional(),
    })
    .strict(),
  agent: z
    .object({
      languages: z.array(z.string().max(20)).min(1).max(6).optional(),
      voice: z.string().max(120).optional(),
      greeting: z.string().max(1000).optional(),
      pickup_minutes: z.number().int().min(1).max(180).optional(),
      handoff_number: phone.optional(),
      instructions: z.string().max(5000).optional(),
      after_hours: z
        .enum(["information_only", "scheduled_orders", "accept_orders"])
        .optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  model: z
    .object({
      provider: z
        .enum(["deepseek", "qwen", "ollama", "vllm", "sglang", "generic"])
        .optional(),
      model: z.string().min(1).max(160).optional(),
      endpoint: z.string().url().max(1000).optional(),
      api_key: z.string().max(2000).optional(),
      hosting: z.enum(["hosted", "self-hosted", "self_hosted"]).optional(),
      fallback_enabled: z.boolean().optional(),
      timeout_ms: z.number().int().min(1000).max(60000).optional(),
      headers: z.record(z.string().max(2000)).optional(),
    })
    .strict(),
  pos: z
    .object({
      provider: z
        .enum([
          "dashboard",
          "none",
          "square",
          "webhook",
          "polotab",
          "parrot",
          "zettle",
          "generic",
        ])
        .optional(),
      endpoint: z.string().max(2000).optional(),
      secret: z.string().max(2000).optional(),
      token: z.string().max(2000).optional(),
      location_id: z.string().max(160).optional(),
      retry_limit: z.number().int().min(0).max(5).optional(),
      catalog_mappings: z.record(z.string().max(160)).optional(),
    })
    .strict(),
  payments: z
    .object({
      provider: z.literal("stripe").optional(),
      test_mode: z.literal(true).optional(),
      enabled: z.boolean().optional(),
    })
    .strict(),
  notifications: z
    .object({
      whatsapp: z.boolean().optional(),
      sms: z.boolean().optional(),
      email: z.boolean().optional(),
      manager_phone: phone.optional(),
      email_address: z.union([z.string().email(), z.literal("")]).optional(),
    })
    .strict(),
  phone: z
    .object({
      mode: z.enum(["forwarding", "new_number", "existing"]).optional(),
      ordering_phone: phone.optional(),
      notification_phone: phone.optional(),
      forwarding_enabled: z.boolean().optional(),
    })
    .strict(),
  onboarding: z
    .object({
      step: z.number().int().min(1).max(11).optional(),
      completed: z.boolean().optional(),
    })
    .strict(),
};
export function orderingIsOpen(
  business: Record<string, unknown>,
  at = new Date(),
): boolean {
  const schedule = business.schedule as
    | Record<string, { enabled: boolean; open: string; close: string }>
    | undefined;
  if (!schedule) return true;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: String(business.timezone ?? "America/Mexico_City"),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  if ((business.special_closures as string[] | undefined)?.includes(date))
    return false;
  const day = get("weekday").toLowerCase();
  const minute = Number(get("hour")) * 60 + Number(get("minute"));
  const toMin = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const today = schedule[day];
  if (today?.enabled) {
    const start = toMin(today.open),
      end = toMin(today.close);
    if (start === end) return true;
    if (start < end && minute >= start && minute < end) return true;
    if (start > end && minute >= start) return true;
  }
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  const yesterday = schedule[days[(days.indexOf(day) + 6) % 7]];
  return !!(
    yesterday?.enabled &&
    toMin(yesterday.open) > toMin(yesterday.close) &&
    minute < toMin(yesterday.close)
  );
}
