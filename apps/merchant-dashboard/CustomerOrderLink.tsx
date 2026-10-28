"use client";
import { useState } from "react";
import { Copy, Link, ShieldCheck } from "lucide-react";

type LinkResult = { url?: string; expires_at?: string; revoked?: boolean };

/** The raw customer credential lives only in this open dialog, never browser storage. */
export default function CustomerOrderLink({
  busy,
  expiresAt,
  onRequest,
}: {
  busy: boolean;
  expiresAt?: string;
  onRequest: (method: "POST" | "DELETE") => Promise<LinkResult | undefined>;
}) {
  const [created, setCreated] = useState<LinkResult>();
  const [message, setMessage] = useState("");
  const active = !!expiresAt && Date.parse(expiresAt) > Date.now();

  async function create() {
    setMessage("");
    const result = await onRequest("POST");
    if (result?.url) {
      setCreated(result);
      setMessage("Customer link ready. Share it only with this customer.");
    }
  }

  async function revoke() {
    const result = await onRequest("DELETE");
    if (result?.revoked) {
      setCreated(undefined);
      setMessage("Customer link revoked.");
    }
  }

  async function copy() {
    if (!created?.url) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setMessage("Link copied. No message has been sent.");
    } catch {
      setMessage("Select the link below to copy it.");
    }
  }

  return (
    <section
      aria-label="Customer order link"
      className="form"
      style={{ marginTop: 24 }}
    >
      <h3>
        <Link size={16} aria-hidden="true" /> Let the customer finish online
      </h3>
      <p className="muted">
        They can review this order, finish a draft and open checkout without
        creating an account.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button className="secondary" disabled={busy} onClick={create}>
          {active || created?.url
            ? "Replace customer link"
            : "Create customer link"}
        </button>
        {(active || created?.url) && (
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={revoke}
          >
            Revoke link
          </button>
        )}
      </div>
      {created?.url && (
        <div>
          <label htmlFor="customer-order-link">Customer link</label>
          <input
            id="customer-order-link"
            value={created.url}
            readOnly
            onClick={(event) => event.currentTarget.select()}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="secondary" onClick={copy}>
            <Copy size={15} aria-hidden="true" /> Copy link
          </button>
        </div>
      )}
      <p className="muted">
        <ShieldCheck size={14} aria-hidden="true" /> Links expire after 60
        minutes. Replacing a link stops the previous one from working.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
