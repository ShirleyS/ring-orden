"use client";
import { useState } from "react";
import { Copy, Link, ShieldCheck } from "lucide-react";

type LinkResult = { url?: string; expires_at?: string; revoked?: boolean };
export type CustomerLinkPurpose = "order" | "recovery" | "receipt" | "billing";

/** The raw customer credential lives only in this open dialog, never browser storage. */
export default function CustomerOrderLink({
  busy,
  expiresAt,
  onRequest,
}: {
  busy: boolean;
  expiresAt?: string;
  onRequest: (
    method: "POST" | "DELETE",
    purpose?: CustomerLinkPurpose,
  ) => Promise<LinkResult | undefined>;
}) {
  const [created, setCreated] = useState<LinkResult>();
  const [message, setMessage] = useState("");
  const [purpose, setPurpose] = useState<CustomerLinkPurpose>("order");
  const active =
    ["order", "recovery"].includes(purpose) &&
    !!expiresAt &&
    Date.parse(expiresAt) > Date.now();

  async function create() {
    setMessage("");
    const result = await onRequest("POST", purpose);
    if (result?.url) {
      setCreated(result);
      setMessage("Customer link ready. Share it only with this customer.");
    }
  }

  async function revoke() {
    const result = await onRequest("DELETE", purpose);
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
        <Link size={16} aria-hidden="true" /> Customer links
      </h3>
      <p className="muted">
        Share an order, receipt or billing form through your WhatsApp app.
      </p>
      <label htmlFor="customer-link-purpose">
        What does the customer need?
      </label>
      <select
        id="customer-link-purpose"
        value={purpose}
        disabled={busy}
        onChange={(event) => {
          setPurpose(event.target.value as CustomerLinkPurpose);
          setCreated(undefined);
          setMessage("");
        }}
      >
        <option value="order">Review and finish order</option>
        <option value="recovery">Resume dropped call · 10 minutes</option>
        <option value="billing">RFC / billing form</option>
        <option value="receipt">Completed-order receipt</option>
      </select>
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
        <ShieldCheck size={14} aria-hidden="true" /> Links expire after{" "}
        {purpose === "recovery" ? "10" : "60"} minutes. Keep links private.
        Creating an order or recovery link replaces the previous order link.
      </p>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
