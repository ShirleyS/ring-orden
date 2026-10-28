import { useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Mic, MicOff, Send, FileText } from "lucide-react";
import {
  readCallerCommand,
  appendCallerMessage,
} from "../../packages/ring-orden-connect/src/caller-phone";
import type { CallerMessage } from "../../packages/ring-orden-connect/src/caller-phone";
/** A caller-side test phone; only its exact dashboard parent owns voice and messages. */
export default function CallerPhone() {
  const [contact, setContact] = useState({
    name: "Ring Orden",
    number: "+52 55 91100000",
  });
  const [status, setStatus] = useState("idle"),
    [ready, setReady] = useState(false),
    [muted, setMuted] = useState(false),
    [error, setError] = useState("");
  const [messages, setMessages] = useState<CallerMessage[]>([]),
    [text, setText] = useState("");
  const sendRef = useRef<
    (type: string, payload?: Record<string, unknown>) => void
  >(() => {});
  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const origin = params.get("parent_origin"),
      session = params.get("session");
    const peer = window.parent !== window ? window.parent : window.opener;
    if (!peer || origin !== window.location.origin || !session) {
      setError("Abre este teléfono desde Phone & agent en Ring Orden.");
      return;
    }
    const send = (type: string, payload: Record<string, unknown> = {}) => {
      if (!peer.closed)
        peer.postMessage(
          { protocol: "browser-phone", v: 1, session, type, ...payload },
          origin,
        );
    };
    sendRef.current = send;
    let configured = false;
    const receive = (event: MessageEvent) => {
      const message = readCallerCommand(event, peer, origin, session);
      if (!message || (!configured && message.type !== "configure")) return;
      if (message.type === "configure") {
        configured = true;
        setContact(message.contact);
        setReady(true);
        send("configured");
      } else if (message.type === "call.state") {
        setStatus(message.status);
        setMuted(message.muted ?? false);
        setError(message.error ?? "");
      } else if (message.type === "message.received")
        setMessages((items) =>
          appendCallerMessage(items, {
            id: message.id,
            text: message.text,
            from: "them",
            link: message.link,
          }),
        );
      else
        setMessages((items) =>
          items.map((item) =>
            item.id === message.id
              ? { ...item, status: message.ok ? "sent" : "failed" }
              : item,
          ),
        );
    };
    window.addEventListener("message", receive);
    send("ready");
    const timer = setInterval(() => {
      if (peer.closed) {
        setReady(false);
        setStatus("ended");
        setError("El panel de Ring Orden se cerró.");
      } else if (!configured) send("ready");
    }, 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("message", receive);
      send("call.end.request");
      sendRef.current = () => {};
    };
  }, []);
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: "nearest" });
  }, [messages]);
  const active = status === "active",
    calling = active || status === "connecting";
  const sendText = () => {
    if (!text.trim() || !active) return;
    const id = crypto.randomUUID();
    sendRef.current("message.request", { id, text: text.trim() });
    setMessages((items) =>
      appendCallerMessage(items, {
        id,
        text: text.trim(),
        from: "me",
        status: "sending",
      }),
    );
    setText("");
  };
  return (
    <main
      style={{
        minHeight: "100dvh",
        background: "#efeae2",
        fontFamily: "system-ui,sans-serif",
        color: "#183b33",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <header
        style={{
          background: "#075e54",
          color: "#fff",
          padding: "20px 18px",
          display: "flex",
          alignItems: "center",
          gap: 12,
        }}
      >
        <div style={{ background: "#fff2", borderRadius: "50%", padding: 12 }}>
          <Phone size={22} />
        </div>
        <div style={{ flex: 1 }}>
          <strong>{contact.name}</strong>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{contact.number}</div>
        </div>
        <span style={{ fontSize: 11 }}>TEST</span>
      </header>
      <section
        style={{
          background: "#fff9",
          padding: "14px 18px",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span role="status" style={{ flex: 1, fontSize: 13 }}>
          {!ready
            ? "Conectando con Ring Orden…"
            : status === "active"
              ? muted
                ? "Micrófono silenciado"
                : "Llamada en curso"
              : status === "connecting"
                ? "Conectando llamada…"
                : status === "ended"
                  ? "Llamada finalizada"
                  : "Listo para llamar"}
        </span>
        <button
          aria-label={calling ? "Finalizar llamada" : "Llamar"}
          disabled={!ready}
          onClick={() =>
            sendRef.current(calling ? "call.end.request" : "call.request")
          }
          style={{
            background: calling ? "#b84440" : "#128c7e",
            color: "#fff",
            border: 0,
            borderRadius: 24,
            padding: "10px 16px",
            display: "flex",
            gap: 8,
            alignItems: "center",
          }}
        >
          {calling ? <PhoneOff size={17} /> : <Phone size={17} />}{" "}
          {calling ? "Finalizar" : "Llamar"}
        </button>
        {active && (
          <button
            aria-label={muted ? "Activar micrófono" : "Silenciar micrófono"}
            onClick={() =>
              sendRef.current("call.mute.request", { muted: !muted })
            }
          >
            {muted ? <MicOff size={18} /> : <Mic size={18} />}
          </button>
        )}
      </section>
      {error && (
        <p role="alert" style={{ padding: "0 18px", color: "#a23532" }}>
          {error}
        </p>
      )}
      <section
        aria-label="Mensajes de WhatsApp de prueba"
        style={{
          flex: 1,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          minHeight: 240,
        }}
      >
        {!messages.length && (
          <p
            style={{
              fontSize: 13,
              textAlign: "center",
              color: "#637a70",
              margin: "35px 15px",
            }}
          >
            Habla con el agente durante la llamada. Al finalizar un pedido
            confirmado, tu recibo aparecerá aquí.
          </p>
        )}
        {messages.map((message) => (
          <article
            key={message.id}
            style={{
              alignSelf: message.from === "me" ? "flex-end" : "flex-start",
              background: message.from === "me" ? "#d9fdd3" : "#fff",
              borderRadius: 14,
              padding: "13px 16px",
              maxWidth: "92%",
              boxShadow: "0 1px 2px #0001",
            }}
          >
            <p
              style={{
                whiteSpace: "pre-wrap",
                fontSize: 14,
                lineHeight: 1.55,
                margin: 0,
              }}
            >
              {message.text}
            </p>
            {message.link && (
              <a
                href={message.link.url}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: "flex",
                  gap: 8,
                  alignItems: "center",
                  marginTop: 12,
                  paddingTop: 10,
                  borderTop: "1px solid #e3eae5",
                  color: "#087c69",
                  fontWeight: 650,
                }}
              >
                <FileText size={18} />
                {message.link.label} ↗
              </a>
            )}
            {message.status && (
              <small
                style={{
                  display: "block",
                  textAlign: "right",
                  color: "#76887b",
                  fontSize: 10,
                }}
              >
                {message.status === "failed"
                  ? "No enviado"
                  : message.status === "sent"
                    ? "Enviado"
                    : "Enviando…"}
              </small>
            )}
          </article>
        ))}
        <div ref={bottom} />
      </section>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          sendText();
        }}
        style={{ padding: 12, display: "flex", gap: 8, background: "#f7f7f2" }}
      >
        <input
          aria-label="Mensaje al agente"
          placeholder={
            active ? "Mensaje al agente…" : "Llama para hablar con el agente"
          }
          value={text}
          disabled={!active}
          onChange={(event) => setText(event.target.value)}
          style={{
            flex: 1,
            minWidth: 0,
            border: "1px solid #d8e0da",
            borderRadius: 24,
            padding: "12px 15px",
            background: "#fff",
          }}
        />
        <button
          aria-label="Enviar mensaje"
          disabled={!active || !text.trim()}
          style={{
            border: 0,
            borderRadius: "50%",
            background: "#128c7e",
            color: "#fff",
            padding: 12,
          }}
        >
          <Send size={19} />
        </button>
      </form>
      <footer
        style={{
          fontSize: 10,
          textAlign: "center",
          padding: "6px 12px 12px",
          color: "#758679",
        }}
      >
        Teléfono de prueba de Ring Orden · Los recibos abren en Lovable
      </footer>
    </main>
  );
}
