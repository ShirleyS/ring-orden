"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, X } from "lucide-react";
import { api } from "./types";
import { BrowserPhoneFrame, type PhoneLaunch } from "./BrowserPhoneFrame";
import { Conversation } from "@elevenlabs/client";
import { withDeadline } from "../../packages/ring-orden-connect/src/browser-phone";

import { waitForCallReceipt } from "../../packages/ring-orden-connect/src/call-receipt";
import type {
  CallReceiptMessage,
  CallReceiptResult,
} from "../../packages/ring-orden-connect/src/call-receipt";

type Phase =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";
type VoiceSession = {
  endSession: () => Promise<void>;
  getId: () => string;
  setMicMuted: (muted: boolean) => void;
  setVolume?: (options: { volume: number }) => void;
  sendUserMessage?: (text: string) => void;
};
export interface VoiceCallProps {
  launch?: PhoneLaunch;
  onClose: () => void;
  notify: (message: string) => void;
  onUpdate?: () => Promise<void>;
}

/** Real ElevenLabs audio session. No microphone request occurs until Start call is clicked. */
export function VoiceCall({ onClose, notify, onUpdate, launch }: VoiceCallProps) {
  const [receiptState, setReceiptState] = useState("");
  const [receiptAttempt, setReceiptAttempt] = useState(0);
  const [receiptMessages, setReceiptMessages] = useState<CallReceiptMessage[]>(
    [],
  );
  const receiptRequests = useRef(new Set<string>());
  const receiptAbort = useRef(new AbortController());
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [stage, setStage] = useState("Waiting for Start call");
  const [agentId, setAgentId] = useState("");
  const mounted = useRef(false),
    generation = useRef(0),
    starting = useRef(false);
  const startOwner = useRef<symbol | null>(null);
  const session = useRef<VoiceSession | null>(null),
    request = useRef<AbortController | null>(null),
    permissionStream = useRef<MediaStream | null>(null);
  const callbacks = useRef({ notify, onUpdate, onClose });
  useEffect(() => {
    callbacks.current = { notify, onUpdate, onClose };
  }, [notify, onUpdate, onClose]);
  const releasePermissionStream = useCallback(() => {
    permissionStream.current?.getTracks().forEach((track) => track.stop());
    permissionStream.current = null;
  }, []);
  const refresh = useCallback(() => {
    void callbacks.current.onUpdate?.().catch(() => {
      /* Dashboard polling can recover independently. */
    });
  }, []);

  const stop = useCallback(async () => {
    startOwner.current = null;
    generation.current++;
    starting.current = false;
    request.current?.abort();
    request.current = null;
    releasePermissionStream();
    const current = session.current;
    session.current = null;
    if (mounted.current) {
      setPhase("ended");
      setStage("Call ended");
      setMuted(false);
    }
    try {
      await current?.endSession();
    } catch {
      if (mounted.current)
        callbacks.current.notify(
          "The connection has closed. You can start another call.",
        );
    }
    refresh();
  }, [refresh, releasePermissionStream]);
  const close = useCallback(() => {
    receiptAbort.current.abort();
    void stop();
    callbacks.current.onClose();
  }, [stop]);
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    receiptAbort.current = new AbortController();
    mounted.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeRef.current();
    };
    document.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      receiptAbort.current.abort();
      // This generation counter invalidates asynchronous work during cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++;
      startOwner.current = null;
      starting.current = false;
      request.current?.abort();
      request.current = null;
      releasePermissionStream();
      const current = session.current;
      session.current = null;
      void current?.endSession().catch(() => {});
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", escape);
    };
  }, [releasePermissionStream]);

  useEffect(() => {
    if (
      !conversationId ||
      !["ended", "error"].includes(phase) ||
      receiptRequests.current.has(conversationId)
    )
      return;
    receiptRequests.current.add(conversationId);
    const signal = receiptAbort.current.signal;
    setReceiptState("Preparing your receipt…");
    void waitForCallReceipt(
      conversationId,
      (id, requestSignal) =>
        api<CallReceiptResult>(
          "/voice/receipt",
          "POST",
          { conversation_id: id },
          requestSignal,
        ),
      { signal },
    )
      .then((result) => {
        if (signal.aborted) return;
        if (result.status === "READY") {
          setReceiptMessages((messages) =>
            messages.some((m) => m.id === result.message.id)
              ? messages
              : [...messages, result.message],
          );
          setReceiptState(
            "Your receipt is ready. Open it below or in the connected WhatsApp test phone.",
          );
        } else
          setReceiptState(
            result.status === "UNCONFIRMED"
              ? "This call has no confirmed order. No receipt was sent."
              : "The call’s order has not arrived yet. Close and check Orders, or retry receipt delivery.",
          );
      })
      .catch((cause) => {
        if (!signal.aborted)
          setReceiptState(
            "Receipt delivery needs attention: " +
              (cause instanceof Error ? cause.message : "Please retry."),
          );
      });
  }, [phase, conversationId, receiptAttempt]);

  const start = async () => {
    if (starting.current || session.current) return;
    const owner = Symbol("voice-start");
    startOwner.current = owner;
    // A new call owns a fresh receipt wait; the ended call cannot update its UI.
    receiptAbort.current.abort();
    receiptAbort.current = new AbortController();
    setReceiptState("");
    setReceiptMessages([]);
    const attempt = ++generation.current;
    starting.current = true;
    setPhase("connecting");
    setError("");
    setMuted(false);
    setStage("Requesting ElevenLabs connection (up to 15 seconds)");
    setAgentId("");
    setConversationId("");
    let connectTimer: ReturnType<typeof setTimeout> | undefined;
    let signedTimer: ReturnType<typeof setTimeout> | undefined;
    let failed = false;
    let finished = false;
    const current = () => mounted.current && generation.current === attempt;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error(
          "Voice calls need HTTPS and a browser with microphone access.",
        );
      const controller = new AbortController();
      request.current = controller;
      signedTimer = setTimeout(() => controller.abort(), 15000);
      // Fetch configuration first: an unconfigured workspace never prompts for a microphone.
      const payload = await withDeadline(
        api<{
          signed_url?: string;
          agent_id?: string;
          error?: string | { message?: string };
          message?: string;
        }>("/voice/signed-url", "POST", {}, controller.signal),
        15000,
        "The ElevenLabs connection request timed out. Please try again.",
      );
      clearTimeout(signedTimer);
      signedTimer = undefined;
      if (!current()) return;
      setAgentId(payload.agent_id || "");
      if (!payload.signed_url && !payload.agent_id)
        throw new Error(
          "The voice provider did not return a conversation connection.",
        );
      if (payload.signed_url) {
        const signed = new URL(payload.signed_url);
        if (
          signed.protocol !== "wss:" ||
          !(
            signed.hostname === "elevenlabs.io" ||
            signed.hostname.endsWith(".elevenlabs.io")
          )
        )
          throw new Error(
            "The voice provider returned an invalid conversation URL.",
          );
        const signedAgentId = signed.searchParams.get("agent_id");
        if (
          signedAgentId &&
          /^(agent_|seng_)[a-zA-Z0-9_-]+$/.test(signedAgentId)
        )
          setAgentId(signedAgentId);
      } else if (!/^(agent_|seng_)[a-zA-Z0-9_-]+$/.test(payload.agent_id!)) {
        throw new Error("The voice provider returned an invalid agent ID.");
      }
      // This method runs only in response to the user's explicit Start call action.
      setStage("Waiting for microphone permission (up to 30 seconds)");
      let permissionExpired = false;
      const pendingPermission = navigator.mediaDevices.getUserMedia({
        audio: true,
      });
      void pendingPermission
        .then((lateStream) => {
          if (permissionExpired || !current())
            lateStream.getTracks().forEach((track) => track.stop());
        })
        .catch(() => {});
      let stream: MediaStream;
      try {
        stream = await withDeadline(
          pendingPermission,
          30000,
          "Microphone permission timed out. Allow the microphone and try again.",
        );
      } catch (cause) {
        permissionExpired = true;
        throw cause;
      }
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      permissionStream.current = stream;
      setStage("Loading ElevenLabs audio client (up to 20 seconds)");
      // Load audio with the application so a later deployment cannot remove its lazy chunk.
      if (!current()) return;
      const sessionOptions = {
        connectionType: "websocket",
        textOnly: false,
        onConversationCreated: (connected) => {
          if (current() && !failed && !finished) session.current = connected;
          else void connected.endSession().catch(() => {});
        },
        onConnect: ({ conversationId: id }) => {
          if (current() && !failed && !finished) {
            setConversationId(id);
            setPhase("listening");
            setStage("Connected to ElevenLabs agent");
          }
        },
        onModeChange: ({ mode }) => {
          if (current() && !failed && !finished)
            setPhase(mode === "speaking" ? "speaking" : "listening");
        },
        // Voice transcripts stay out of the caller's message history.
        onMessage: () => {
          if (current()) refresh();
        },
        onDisconnect: (details) => {
          finished = true;
          if (current()) {
            session.current = null;
            starting.current = false;
            setMuted(false);
            if (details.reason === "error") {
              failed = true;
              setPhase("error");
              setStage("ElevenLabs connection interrupted");
              setError(
                details.message ||
                  "The voice connection was interrupted. Please try again.",
              );
            } else if (!failed) {
              setPhase("ended");
              setStage("Call ended");
            }
            releasePermissionStream();
            refresh();
          }
        },
        onError: (message: string) => {
          failed = true;
          if (current()) {
            starting.current = false;
            setPhase("error");
            setStage("ElevenLabs connection error");
            setError(
              message ||
                "The voice connection was interrupted. Please try again.",
            );
            releasePermissionStream();
            const active = session.current;
            session.current = null;
            void active?.endSession().catch(() => {});
            refresh();
          }
        },
      } satisfies Partial<Parameters<typeof Conversation.startSession>[0]>;
      setStage("Connecting ElevenLabs audio session (up to 25 seconds)");
      const pending = payload.signed_url
        ? Conversation.startSession({
            signedUrl: payload.signed_url,
            ...sessionOptions,
          })
        : Conversation.startSession({
            agentId: payload.agent_id!,
            ...sessionOptions,
          });
      // If the dialog closes while the SDK connects, close its late-arriving session too.
      void pending
        .then((connected) => {
          if (!current() || failed || finished)
            void connected.endSession().catch(() => {});
        })
        .catch(() => {});
      const connected = await Promise.race([
        pending,
        new Promise<never>((_, reject) => {
          connectTimer = setTimeout(
            () =>
              reject(
                new Error(
                  "The voice connection took too long. Please try again.",
                ),
              ),
            25000,
          );
        }),
      ]);
      clearTimeout(connectTimer);
      connectTimer = undefined;
      if (!current() || failed || finished) {
        await connected.endSession().catch(() => {});
        return;
      }
      releasePermissionStream();
      session.current = connected;
      setConversationId(connected.getId());
      setStage("Connected to ElevenLabs agent");
    } catch (cause) {
      if (!current()) return;
      generation.current++;
      failed = true;
      const failedSession = session.current;
      session.current = null;
      void failedSession?.endSession().catch(() => {});
      const problem =
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone access was declined. Allow the microphone in your browser to start a voice call."
          : cause instanceof DOMException && cause.name === "NotFoundError"
            ? "No microphone was found. Connect a microphone and try again."
            : cause instanceof DOMException && cause.name === "AbortError"
              ? "The voice service took too long to respond. Please try again."
              : cause instanceof Error
                ? cause.message
                : "The voice call could not start. Please try again.";
      setStage((value) => `Failed: ${value}`);
      setError(problem);
      setPhase("error");
      callbacks.current.notify(problem);
    } finally {
      if (signedTimer) clearTimeout(signedTimer);
      if (connectTimer) clearTimeout(connectTimer);
      if (startOwner.current === owner) {
        startOwner.current = null;
        starting.current = false;
        request.current = null;
        releasePermissionStream();
      }
    }
  };
  const active = phase === "listening" || phase === "speaking";
  const connecting = phase === "connecting";
  const status =
    phase === "idle"
      ? "Ready when you are"
      : phase === "connecting"
        ? "Connecting your call…"
        : phase === "listening"
          ? muted
            ? "Microphone muted"
            : "Listening to you"
          : phase === "speaking"
            ? "Your agent is speaking"
            : phase === "ended"
              ? "Call ended"
              : "Connection needs attention";
  const toggleMute = () => {
    if (!session.current) return;
    try {
      const next = !muted;
      session.current.setMicMuted(next);
      setMuted(next);
    } catch {
      callbacks.current.notify(
        "The microphone could not be changed. End the call and try again.",
      );
    }
  };
  return (
    <div className="modal-backdrop" onClick={close}>
      <section
        className="modal voice-phone-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="voice-call-title"
        aria-describedby="voice-call-description"
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id="voice-call-title">Give your agent a ring.</h2>
            <p id="voice-call-description">
              A real conversation with your configured ElevenLabs agent.
            </p>
          </div>
          <button
            className="icon-button"
            aria-label="Close voice call"
            onClick={close}
          >
            <X size={20} />
          </button>
        </header>
        <div
          className="modal-body"
          style={{ display: "grid", gap: 20, padding: 24 }}
        >
          <BrowserPhoneFrame
            launch={launch}
            messages={receiptMessages}
            phase={phase}
            error={error}
            stage={stage}
            muted={muted}
            onStart={() => {
              void start();
            }}
            onStop={() => {
              void stop();
            }}
            onMute={(next) => {
              if (session.current) {
                try {
                  session.current.setMicMuted(next);
                  setMuted(next);
                  return true;
                } catch {
                  callbacks.current.notify(
                    "The microphone could not be changed. Please try again.",
                  );
                }
              }
              return false;
            }}
            onVolume={(volume) => {
              try {
                session.current?.setVolume?.({ volume });
              } catch {
                callbacks.current.notify(
                  "The call volume could not be changed. Please try again.",
                );
              }
            }}
            onMessage={(text) => {
              if (
                !(phase === "listening" || phase === "speaking") ||
                !session.current?.sendUserMessage
              )
                return false;
              session.current.sendUserMessage(text);
              return true;
            }}
          />
          <p
            role="status"
            aria-live="polite"
            style={{ margin: 0, textAlign: "center" }}
          >
            {status}
          </p>
          {receiptState && (
            <div className="info-banner" role="status">
              <p>{receiptState}{receiptState === "Preparing your receipt…" && " You can close this window or start another call. Saved orders remain in Orders."}</p>
              {receiptState !== "Preparing your receipt…" &&
                !receiptState.startsWith("Your receipt") && (
                  <button
                    className="secondary"
                    onClick={() => {
                      receiptRequests.current.delete(conversationId);
                      setReceiptState("");
                      setReceiptAttempt((attempt) => attempt + 1);
                    }}
                  >
                    Retry receipt
                  </button>
                )}
            </div>
          )}
          {receiptMessages.map((message) => (
            <p key={message.id}>
              <a
                href={message.link.url}
                target="_blank"
                rel="noopener noreferrer"
              >
                {message.link.label}
              </a>
            </p>
          ))}
          {error && (
            <div
              className="info-banner"
              role="alert"
              style={{ background: "#fbefed", color: "#8a4144" }}
            >
              <PhoneOff size={18} />
              <p>{error}</p>
            </div>
          )}
          {!active && !connecting && (
            <div className="info-banner">
              <ShieldCheck size={18} />
              <p>
                Voice uses ElevenLabs. Menu, prices, confirmation, and payments
                stay under Ring Orden’s transaction rules.
              </p>
            </div>
          )}
          {agentId && (
            <p
              className="muted"
              style={{ fontSize: 11, overflowWrap: "anywhere" }}
            >
              ElevenLabs agent: {agentId}
            </p>
          )}
          {conversationId && (
            <p
              className="muted"
              style={{ fontSize: 10, overflowWrap: "anywhere" }}
            >
              Conversation {conversationId}
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="secondary" onClick={close}>
            Close
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {active && (
              <button
                className="secondary"
                onClick={toggleMute}
                aria-pressed={muted}
              >
                {muted ? <MicOff size={16} /> : <Mic size={16} />}{" "}
                {muted ? "Unmute" : "Mute"}
              </button>
            )}
            {active || connecting ? (
              <button className="danger" onClick={() => void stop()}>
                <PhoneOff size={16} />
                {connecting ? "Cancel" : "End call"}
              </button>
            ) : (
              <button
                className="primary"
                onClick={() => void start()}
              >
                <Phone size={16} />
                {phase === "idle" ? "Start call" : "Call again"}
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
export default VoiceCall;
