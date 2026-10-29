"use client";

import { useEffect, useRef, useState } from "react";
import {
  browserPhoneUrl,
  openBrowserPhonePopup,
  recoverBlankPhonePopup,
  handleBrowserPhonePopupClosed,
  handleBrowserPhoneMuteRequest,
  readBrowserPhoneEvent,
} from "../../packages/ring-orden-connect/src/browser-phone";

export type BrowserPhonePhase =
  | "idle"
  | "connecting"
  | "listening"
  | "speaking"
  | "ended"
  | "error";
export type PhoneLaunch = { instance: string; origin: string; popup: Window | null };
export function launchCallerPhone(): PhoneLaunch {
  const instance = crypto.randomUUID();
  const origin = "https://browser-bell-companion.lovable.app";
  const popup = openBrowserPhonePopup(window.open.bind(window), origin, window.location.origin, instance);
  recoverBlankPhonePopup(popup, browserPhoneUrl(origin, window.location.origin, instance));
  popup?.focus();
  return { instance, origin, popup };
}

export interface BrowserPhoneFrameProps {
  launch?: PhoneLaunch;
  phase: BrowserPhonePhase;
  error: string;
  stage: string;
  muted: boolean;
  messages?: import("../../packages/ring-orden-connect/src/call-receipt").CallReceiptMessage[];
  onStart: () => void;
  onStop: () => void;
  onMute: (muted: boolean) => boolean;
  onVolume: (volume: number) => void;
  onMessage: (text: string) => boolean;
}
const defaultOrigin = () => "https://browser-bell-companion.lovable.app";

export function BrowserPhoneFrame(props: BrowserPhoneFrameProps) {
  const [instance] = useState(() =>
    props.launch?.instance || Array.from(crypto.getRandomValues(new Uint8Array(12)), (n) =>
      n.toString(16).padStart(2, "0"),
    ).join(""),
  );
  const [origin] = useState(() => {
    if (props.launch) return props.launch.origin;
    const env = (
      import.meta as ImportMeta & {
        env?: { VITE_BROWSER_PHONE_ORIGIN?: string };
      }
    ).env;
    try {
      const configured = new URL(
        env?.VITE_BROWSER_PHONE_ORIGIN || defaultOrigin(),
      );
      return configured.protocol === "https:" ||
        (configured.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(configured.hostname))
        ? configured.origin
        : defaultOrigin();
    } catch {
      return defaultOrigin();
    }
  });
  const url = browserPhoneUrl(origin, window.location.origin, instance);
  const frame = useRef<HTMLIFrameElement>(null);
  const popup = useRef<Window | null>(props.launch?.popup || null);
  const iframeReady = useRef(false);
  const popupReady = useRef(false);
  const configuredPeer = useRef<Window | null>(null);
  const handshakeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const current = useRef(props);
  useEffect(() => {
    current.current = props;
  }, [props]);
  const [bridge, setBridge] = useState("Loading caller phone…");
  const [ready, setReady] = useState(false);
  const [inPopup, setInPopup] = useState(Boolean(props.launch?.popup));
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
  const sendMessages = () => {
    for (const message of current.current.messages ?? [])
      send("message.received", message);
  };
  const waitForReady = () => {
    clearTimeout(handshakeTimer.current);
    handshakeTimer.current = setTimeout(
      () => {
        if (popup.current && !popupReady.current) {
          popup.current.close();
          popup.current = null;
          setInPopup(false);
          configuredPeer.current = null;
          setReady(false);
          configure(frame.current?.contentWindow);
          sendState(frame.current?.contentWindow);
        }
        setBridge(
          "The phone window did not connect. Use the phone below or click Open phone window to try again.",
        );
      },
      10000,
    );
  };
  useEffect(() => {
    waitForReady();
    const handle = (event: MessageEvent) => {
      const peer = popup.current || frame.current?.contentWindow;
      const message = readBrowserPhoneEvent(event, peer, origin, instance);
      if (!message) {
        return;
      }
      switch (message.type) {
        case "ready":
          // Ready only means the document loaded, not that configuration arrived.
          configuredPeer.current = null;
          popupReady.current = false;
          setReady(false);
          setBridge("Connecting the phone to Ring Orden…");
          configure();
          break;
        case "configured":
          configuredPeer.current = peer ?? null;
          if (popup.current) popupReady.current = true;
          clearTimeout(handshakeTimer.current);
          if (!popup.current) iframeReady.current = true;
          setReady(true);
          setBridge("Caller phone connected");
          sendState();
          sendMessages();
          break;
        case "call.request":
          current.current.onStart();
          break;
        case "call.end.request":
          current.current.onStop();
          break;
        case "call.mute.request":
          handleBrowserPhoneMuteRequest(
            message.muted,
            current.current.onMute,
            () => sendState(),
          );
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
    let recoveryAttempts = 0;
    const watchPopup = setInterval(() => {
      const selectedPeer = popup.current || frame.current?.contentWindow;
      if (selectedPeer && configuredPeer.current !== selectedPeer) configure(selectedPeer);
      if (popup.current && !popupReady.current && recoveryAttempts < 3) {
        if (recoverBlankPhonePopup(popup.current, url)) {
          recoveryAttempts++;
          setBridge("Retrying the phone window…");
        }
      }
      handleBrowserPhonePopupClosed(
        popup.current,
        () => current.current.onStop(),
        () => {
          popup.current = null;
          popupReady.current = false;
          configuredPeer.current = null;
          setInPopup(false);
          setReady(false);
          setBridge("Popup closed; reconnecting the phone…");
          configure(frame.current?.contentWindow);
          sendState(frame.current?.contentWindow);
          sendMessages();
          if (!iframeReady.current) waitForReady();
        },
      );
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
  useEffect(() => {
    if (ready) sendMessages();
  }, [props.messages, ready]); // eslint-disable-line react-hooks/exhaustive-deps
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
    popupReady.current = false;
    configuredPeer.current = null;
    recoverBlankPhonePopup(opened, url);
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
          maxWidth: 400,
          margin: "0 auto",
          height: 790,
          border: "1px solid #e1e5df",
          borderRadius: 20,
          display: inPopup ? "none" : "block",
          background: "#fafaf7",
        }}
      />
      {inPopup && <p>{ready ? "Caller phone is open in its own window." : "Opening your phone window…"}</p>}
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
        Open phone window ↗
      </a>
    </div>
  );
}
