"use client";

import { useEffect, useRef, useState } from "react";
import {
  browserPhoneUrl,
  readBrowserPhoneEvent,
} from "../../packages/ring-orden-connect/src/browser-phone";

export type BrowserPhonePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";
export interface BrowserPhoneFrameProps {
  phase: BrowserPhonePhase;
  error: string;
  stage: string;
  muted: boolean;
  onStart: () => void;
  onStop: () => void;
  onMute: (muted: boolean) => void;
  onVolume: (volume: number) => void;
  onMessage: (text: string) => boolean;
}
const DEFAULT_ORIGIN = "https://preview--browser-bell-companion.lovable.app";

export function BrowserPhoneFrame(props: BrowserPhoneFrameProps) {
  const [instance] = useState(() =>
    Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
  );
  const [origin] = useState(() => {
    const env = (
      import.meta as ImportMeta & {
        env?: { VITE_BROWSER_PHONE_ORIGIN?: string };
      }
    ).env;
    try {
      const configured = new URL(
        env?.VITE_BROWSER_PHONE_ORIGIN || DEFAULT_ORIGIN,
      );
      return configured.protocol === "https:" ||
        (configured.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(configured.hostname))
        ? configured.origin
        : DEFAULT_ORIGIN;
    } catch {
      return DEFAULT_ORIGIN;
    }
  });
  const url = browserPhoneUrl(origin, window.location.origin, instance);
  const frame = useRef<HTMLIFrameElement>(null);
  const popup = useRef<Window | null>(null);
  const iframeReady = useRef(false);
  const handshakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const current = useRef(props);
  useEffect(() => {
    current.current = props;
  }, [props]);
  const [bridge, setBridge] = useState("Loading caller phone…");
  const [ready, setReady] = useState(false);
  const [inPopup, setInPopup] = useState(false);
  const send = (
    type: string,
    payload: Record<string, unknown> = {},
    peer = popup.current || frame.current?.contentWindow,
  ) => {
    peer?.postMessage(
      { protocol: "browser-phone", v: 1, session: instance, type, ...payload },
      origin,
    );
  };
  const configure = (peer?: Window | null) => {
    send(
      "configure",
      {
        contact: { name: "Ring Orden", number: "+52 55 91100000" },
        lang: "en",
      },
      peer,
    );
  };
  const sendState = (peer?: Window | null) => {
    const value = current.current;
    const status =
      value.phase === "listening" || value.phase === "speaking"
        ? "active"
        : value.phase;
    send(
      "call.state",
      {
        status,
        muted: value.muted,
        ...(value.error ? { error: value.error } : {}),
      },
      peer,
    );
  };
  const waitForReady = () => {
    clearTimeout(handshakeTimer.current);
    handshakeTimer.current = setTimeout(
      () =>
        setBridge(
          "Caller phone has not connected after 3 seconds. Check the launch destination below or use Start call.",
        ),
      3000,
    );
  };
  useEffect(() => {
    waitForReady();
    const handle = (event: MessageEvent) => {
      const peer = popup.current || frame.current?.contentWindow;
      const message = readBrowserPhoneEvent(event, peer, origin, instance);
      if (!message) return;
      switch (message.type) {
        case "ready":
          clearTimeout(handshakeTimer.current);
          if (!popup.current) iframeReady.current = true;
          setReady(true);
          setBridge("Caller phone connected");
          configure();
          sendState();
          break;
        case "call.request":
          current.current.onStart();
          break;
        case "call.end.request":
          current.current.onStop();
          break;
        case "call.mute.request":
          current.current.onMute(message.muted);
          break;
        case "call.volume.request":
          current.current.onVolume(message.volume);
          break;
        case "message.request": {
          let ok = false;
          try {
            ok = current.current.onMessage(message.text);
          } catch {
            /* A failed send is never shown as sent. */
          }
          send("message.ack", { id: message.id, ok });
          break;
        }
      }
    };
    window.addEventListener("message", handle);
    const watchPopup = setInterval(() => {
      if (!popup.current?.closed) return;
      popup.current = null;
      setInPopup(false);
      setReady(iframeReady.current);
      setBridge(
        iframeReady.current
          ? "Caller phone connected"
          : "Popup closed; reconnecting embedded caller phone…",
      );
      configure(frame.current?.contentWindow);
      sendState(frame.current?.contentWindow);
      if (!iframeReady.current) waitForReady();
    }, 500);
    return () => {
      clearTimeout(handshakeTimer.current);
      clearInterval(watchPopup);
      window.removeEventListener("message", handle);
      popup.current?.close();
      popup.current = null;
    };
    // Instance and origin are fixed for the lifetime of this modal. Live callbacks use current.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instance, origin]);
  useEffect(() => {
    if (ready) sendState();
  }, [props.phase, props.error, props.muted, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  const openPhone = () => {
    const opened = window.open(
      url,
      `ring-phone-${instance}`,
      "popup,width=430,height=820",
    );
    if (!opened) {
      setBridge(
        "The popup was blocked. Use the embedded caller phone or allow popups.",
      );
      return;
    }
    popup.current = opened;
    setInPopup(true);
    setReady(false);
    setBridge("Waiting for the caller popup handshake…");
    waitForReady();
    opened.focus();
    // The child repeats ready until configure arrives, including after a window switch.
  };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <iframe
        ref={frame}
        src={url}
        title="Ring Orden caller phone"
        allow="microphone; autoplay"
        style={{
          width: "100%",
          height: 560,
          border: "1px solid #e1e5df",
          borderRadius: 20,
          display: inPopup ? "none" : "block",
          background: "#fafaf7",
        }}
      />
      {inPopup && <p>Caller phone is open in its own window.</p>}
      <p role="status" style={{ margin: 0, fontSize: 12 }}>
        {bridge}
      </p>
      <p role="status" style={{ margin: 0, fontSize: 12 }}>
        ElevenLabs agent · {props.stage || "Ready for your call"}
      </p>
      <details style={{ fontSize: 11, overflowWrap: "anywhere" }}>
        <summary>Phone &amp; agent connection details</summary>
        <p>Phone destination: {url}</p>
        <p>Instance: {instance}</p>
        <p>Provider: ElevenLabs agent</p>
        <p>
          Agent connection request: {window.location.origin}
          /api/voice/signed-url
        </p>
        <p>Stage: {props.stage || "Waiting for Start call"}</p>
        <p>Bridge: {bridge}</p>
      </details>
      <a
        href={url}
        onClick={(event) => {
          event.preventDefault();
          openPhone();
        }}
        style={{ fontSize: 12 }}
      >
        Open this caller phone instance in a window ↗
      </a>
    </div>
  );
}
