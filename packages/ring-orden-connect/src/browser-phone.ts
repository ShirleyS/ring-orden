export type BrowserPhoneEvent = {
  protocol: "browser-phone";
  v: 1;
  session: string;
} & (
  | { type: "ready" | "call.request" | "call.end.request" }
  | { type: "call.mute.request"; muted: boolean }
  | { type: "call.volume.request"; volume: number }
  | { type: "message.request"; id: string; text: string }
);

export function readBrowserPhoneEvent(
  event: { source: unknown; origin: string; data: unknown },
  frame: unknown,
  origin: string,
  session: string,
): BrowserPhoneEvent | null {
  if (
    !frame ||
    event.source !== frame ||
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
  switch (data.type) {
    case "ready":
    case "call.request":
    case "call.end.request":
      break;
    case "call.mute.request":
      if (typeof data.muted !== "boolean") return null;
      break;
    case "call.volume.request":
      if (
        typeof data.volume !== "number" ||
        !Number.isFinite(data.volume) ||
        data.volume < 0 ||
        data.volume > 1
      )
        return null;
      break;
    case "message.request":
      if (
        typeof data.id !== "string" ||
        !data.id ||
        data.id.length > 200 ||
        typeof data.text !== "string" ||
        !data.text.trim() ||
        data.text.length > 10000
      )
        return null;
      break;
    default:
      return null;
  }
  return data as BrowserPhoneEvent;
}

export function browserPhoneUrl(
  origin: string,
  parentOrigin: string,
  session: string,
): string {
  const url = new URL("/integration", origin);
  url.searchParams.set("parent_origin", parentOrigin);
  url.searchParams.set("session", session);
  url.searchParams.set("embed", "1");
  return url.href;
}

export function openBrowserPhonePopup<T>(
  open: (url: string, name: string, features: string) => T | null,
  origin: string,
  parentOrigin: string,
  instance: string,
): T | null {
  return open(browserPhoneUrl(origin, parentOrigin, instance), `ring-phone-${instance}`, "popup,width=430,height=820");
}

export async function withDeadline<T>(
  pending: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pending,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Stop the live audio owner before returning control to the embedded caller. */
export function handleBrowserPhonePopupClosed(
  popup: { closed: boolean } | null,
  onStop: () => void,
  restoreEmbeddedPeer: () => void,
): boolean {
  if (!popup?.closed) return false;
  onStop();
  restoreEmbeddedPeer();
  return true;
}

/** A rejected SDK mute must undo any optimistic caller UI state. */
export function handleBrowserPhoneMuteRequest(
  muted: boolean,
  onMute: (muted: boolean) => boolean,
  sendCurrentState: () => void,
): boolean {
  let accepted = false;
  try {
    accepted = onMute(muted);
  } catch {
    /* Restore the actual parent state below. */
  }
  if (!accepted) sendCurrentState();
  return accepted;
}
