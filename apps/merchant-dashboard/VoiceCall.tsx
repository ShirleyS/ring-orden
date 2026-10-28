"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  ShieldCheck,
  X,
} from "lucide-react";
import { api } from "./types";

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
};
type TranscriptLine = { id: string; role: "user" | "assistant"; text: string };
export interface VoiceCallProps {
  onClose: () => void;
  notify: (message: string) => void;
  onUpdate?: () => Promise<void>;
}

/** Real ElevenLabs audio session. No microphone request occurs until Start call is clicked. */
export function VoiceCall({ onClose, notify, onUpdate }: VoiceCallProps) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [muted, setMuted] = useState(false);
  const [conversationId, setConversationId] = useState("");
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const mounted = useRef(false),
    generation = useRef(0),
    starting = useRef(false);
  const session = useRef<VoiceSession | null>(null),
    request = useRef<AbortController | null>(null),
    permissionStream = useRef<MediaStream | null>(null);
  const endOfTranscript = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ notify, onUpdate, onClose });
  callbacks.current = { notify, onUpdate, onClose };
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
    generation.current++;
    starting.current = false;
    request.current?.abort();
    request.current = null;
    releasePermissionStream();
    const current = session.current;
    session.current = null;
    if (mounted.current) {
      setPhase("ended");
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
    void stop();
    callbacks.current.onClose();
  }, [stop]);
  useEffect(() => {
    mounted.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("keydown", escape);
    return () => {
      mounted.current = false;
      generation.current++;
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
  }, [close, releasePermissionStream]);
  useEffect(() => {
    endOfTranscript.current?.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
    });
  }, [transcript]);

  const start = async () => {
    if (starting.current || session.current) return;
    const attempt = ++generation.current;
    starting.current = true;
    setPhase("connecting");
    setError("");
    setMuted(false);
    setTranscript([]);
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
      const payload = await api<{
        signed_url?: string;
        error?: string | { message?: string };
        message?: string;
      }>("/voice/signed-url", "POST", {}, controller.signal);
      clearTimeout(signedTimer);
      signedTimer = undefined;
      if (!current()) return;
      if (!payload.signed_url)
        throw new Error(
          "The voice provider did not return a signed conversation URL.",
        );
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
      // This method runs only in response to the user's explicit Start call action.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!current()) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      permissionStream.current = stream;
      const { Conversation } = await import("@elevenlabs/client");
      if (!current()) return;
      const pending = Conversation.startSession({
        signedUrl: payload.signed_url,
        connectionType: "websocket",
        textOnly: false,
        onConversationCreated: (connected) => {
          if (current() && !failed && !finished) session.current = connected;
          else void connected.endSession().catch(() => {});
        },
        onConnect: ({ conversationId: id }) => {
          if (current()) {
            setConversationId(id);
            setPhase("listening");
          }
        },
        onModeChange: ({ mode }) => {
          if (current() && !failed && !finished)
            setPhase(mode === "speaking" ? "speaking" : "listening");
        },
        onMessage: (message: {
          message?: string;
          source?: string;
          role?: string;
        }) => {
          if (!current() || !message.message?.trim()) return;
          const text = message.message;
          const role: TranscriptLine["role"] =
            message.source === "user" || message.role === "user"
              ? "user"
              : "assistant";
          setTranscript((lines) => {
            const last = lines.at(-1);
            if (last?.role === role && last.text === text) return lines;
            return [
              ...lines.slice(-59),
              { id: crypto.randomUUID(), role, text },
            ];
          });
          refresh();
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
              setError(
                details.message ||
                  "The voice connection was interrupted. Please try again.",
              );
            } else if (!failed) setPhase("ended");
            releasePermissionStream();
            refresh();
          }
        },
        onError: (message: string) => {
          failed = true;
          if (current()) {
            setPhase("error");
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
      releasePermissionStream();
      if (!current() || failed || finished) {
        await connected.endSession().catch(() => {});
        return;
      }
      session.current = connected;
      setConversationId(connected.getId());
    } catch (cause) {
      if (!current()) return;
      generation.current++;
      failed = true;
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
      setError(problem);
      setPhase("error");
      callbacks.current.notify(problem);
    } finally {
      if (signedTimer) clearTimeout(signedTimer);
      if (connectTimer) clearTimeout(connectTimer);
      if (generation.current === attempt || failed) {
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
        className="modal wide"
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
          <div style={{ textAlign: "center", padding: "12px 0 4px" }}>
            <div
              aria-hidden="true"
              style={{
                width: 92,
                height: 92,
                margin: "0 auto 18px",
                display: "grid",
                placeItems: "center",
                borderRadius: "50%",
                color: "#fff",
                background: active
                  ? "radial-gradient(circle at 35% 30%,#ca8e96,#8c4357 66%,#623446)"
                  : "radial-gradient(circle at 35% 30%,#9eaa94,#526549)",
                boxShadow: active
                  ? "0 0 0 9px #f5e9eb,0 0 0 18px #fbf4f4"
                  : "0 0 0 9px #eef1e9",
              }}
            >
              {connecting ? (
                <Loader2 className="spin" size={34} />
              ) : phase === "speaking" ? (
                <AudioLines size={36} />
              ) : muted ? (
                <MicOff size={32} />
              ) : (
                <Mic size={32} />
              )}
            </div>
            <p
              role="status"
              aria-live="polite"
              style={{ fontWeight: 600, fontSize: 17, marginBottom: 9 }}
            >
              {status}
            </p>
            <p
              className="muted"
              style={{ lineHeight: 1.7, maxWidth: 430, margin: "0 auto" }}
            >
              {active
                ? "Speak naturally. Interrupt, change your mind, and ask a clarification."
                : phase === "ended"
                  ? "Your conversation has ended. You can make another call."
                  : "Start call asks for microphone access. Your agent’s server tools save and validate each order."}
            </p>
          </div>
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
          {transcript.length > 0 && (
            <div
              aria-label="Live voice transcript"
              aria-live="polite"
              style={{
                maxHeight: 270,
                overflowY: "auto",
                display: "grid",
                gap: 13,
                padding: "14px 2px",
                borderTop: "1px solid #e7e9e2",
              }}
            >
              {transcript.map((line) => (
                <div
                  key={line.id}
                  className={
                    "chat-message " +
                    (line.role === "user" ? "user" : "assistant")
                  }
                >
                  <small style={{ display: "block", marginBottom: 5 }}>
                    {line.role === "user" ? "You" : "Your agent"}
                  </small>
                  <p>{line.text}</p>
                </div>
              ))}
              <div ref={endOfTranscript} />
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
              <button className="primary" onClick={() => void start()}>
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
