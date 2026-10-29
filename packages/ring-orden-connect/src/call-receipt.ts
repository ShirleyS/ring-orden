export type CallReceiptMessage = {
  id: string;
  text: string;
  link: { label: string; url: string };
};
export type CallReceiptResult =
  | { status: "READY"; message: CallReceiptMessage }
  | { status: "WAITING_SESSION" | "UNCONFIRMED" };
/** Hangup may race the final tool write; never guess another call's order. */
export async function waitForCallReceipt(
  conversation: string,
  lookup: (id: string, signal: AbortSignal) => Promise<CallReceiptResult>,
  options: {
    signal?: AbortSignal;
    attempts?: number;
    requestTimeoutMs?: number;
    pause?: () => Promise<void>;
  } = {},
): Promise<CallReceiptResult> {
  const pause =
    options.pause ??
    (() =>
      new Promise<void>((resolve, reject) => {
        if (options.signal?.aborted) {
          reject(options.signal.reason);
          return;
        }
        const abort = () => {
          clearTimeout(timer);
          reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
          options.signal?.removeEventListener("abort", abort);
          resolve();
        }, 2000);
        options.signal?.addEventListener("abort", abort, { once: true });
      }));
  const lookupOnce = async () => {
    options.signal?.throwIfAborted();
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(
      () =>
        controller.abort(new Error("Receipt request timed out. Please retry.")),
      options.requestTimeoutMs ?? 8000,
    );
    let rejectAborted: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      rejectAborted = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", rejectAborted, { once: true });
    });
    try {
      return await Promise.race([
        aborted,
        lookup(conversation, controller.signal),
      ]);
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      if (rejectAborted) controller.signal.removeEventListener("abort", rejectAborted);
    }
  };
  const started = Date.now();
  let last: CallReceiptResult = { status: "WAITING_SESSION" };
  let failure: unknown;
  for (let i = 0; i < (options.attempts ?? 30); i++) {
    options.signal?.throwIfAborted();
    try {
      last = await lookupOnce();
      failure = undefined;
      if (last.status === "READY") return last;
    } catch (error) {
      options.signal?.throwIfAborted();
      failure = error;
    }
    if (Date.now() - started >= 60000) break;
    if (i + 1 < (options.attempts ?? 30)) await pause();
  }
  if (failure) throw failure;
  return last;
}
