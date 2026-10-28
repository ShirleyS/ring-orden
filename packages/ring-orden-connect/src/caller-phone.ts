import { z } from "zod";
export type CallerMessage = {
  id: string;
  text: string;
  from: "me" | "them";
  status?: "sending" | "sent" | "failed";
  link?: { label: string; url: string };
};
const command = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("configure"),
    contact: z.object({ name: z.string().max(60), number: z.string().max(30) }),
  }),
  z.object({
    type: z.literal("call.state"),
    status: z.enum(["idle", "connecting", "active", "ended", "error"]),
    muted: z.boolean().optional(),
    error: z.string().max(1000).optional(),
  }),
  z.object({
    type: z.literal("message.ack"),
    id: z.string().max(128),
    ok: z.boolean(),
  }),
  z.object({
    type: z.literal("message.received"),
    id: z.string().min(1).max(128),
    text: z.string().max(4000),
    link: z
      .object({
        label: z.string().max(80),
        url: z
          .string()
          .url()
          .max(2048)
          .refine((value) => {
            const url = new URL(value);
            return (
              url.protocol === "https:" ||
              (url.protocol === "http:" &&
                ["localhost", "127.0.0.1"].includes(url.hostname))
            );
          }),
      })
      .optional(),
  }),
]);
export function readCallerCommand(
  event: { source: unknown; origin: string; data: unknown },
  parent: unknown,
  origin: string,
  session: string,
) {
  if (
    !parent ||
    event.source !== parent ||
    event.origin !== origin ||
    !event.data ||
    typeof event.data !== "object"
  )
    return null;
  const data = event.data as Record<string, unknown>;
  if (
    data.protocol !== "browser-phone" ||
    data.v !== 1 ||
    data.session !== session
  )
    return null;
  const parsed = command.safeParse(data);
  return parsed.success
    ? {
        protocol: "browser-phone" as const,
        v: 1 as const,
        session,
        ...parsed.data,
      }
    : null;
}
export function appendCallerMessage(
  messages: CallerMessage[],
  message: CallerMessage,
) {
  return messages.some((m) => m.id === message.id)
    ? messages
    : [...messages, message];
}
