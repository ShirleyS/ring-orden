"use client";
import { useState } from "react";
import { api, label } from "./types";

type Billing = {
  revision: number;
  submitted_at?: string;
  details: Record<string, string> | null;
};
type Result = {
  url?: string;
  expires_at?: string;
  revoked?: boolean;
  status?: string;
};
export default function CustomerReceipt({
  orderId,
  expiresAt,
  status,
  busy,
  onRequest,
}: {
  orderId: string;
  expiresAt?: string;
  status?: string;
  busy: boolean;
  onRequest: (
    route: "receipt-link" | "receipt-send",
    method: "POST" | "DELETE",
    body?: unknown,
  ) => Promise<Result | null | undefined>;
}) {
  const [link, setLink] = useState<string>();
  const [consent, setConsent] = useState(false);
  const [message, setMessage] = useState("");
  const [billing, setBilling] = useState<Billing>();
  const [loading, setLoading] = useState(false);
  const active = !!expiresAt && Date.parse(expiresAt) > Date.now();
  async function manage(method: "POST" | "DELETE") {
    const result = await onRequest("receipt-link", method, {});
    if (result?.url) {
      setLink(result.url);
      setMessage("Receipt link ready. No message has been sent.");
    }
    if (result?.revoked) {
      setLink(undefined);
      setMessage("Receipt link revoked.");
    }
  }
  async function send() {
    const result = await onRequest("receipt-send", "POST", {
      customer_opted_in: true,
    });
    if (result?.status) {
      setLink(undefined);
      setMessage(
        `WhatsApp receipt: ${label(result.status)}. Queued means the provider accepted it, not confirmed delivery.`,
      );
    }
  }
  async function loadBilling() {
    setLoading(true);
    setMessage("");
    try {
      setBilling(await api<Billing>(`/orders/${orderId}/billing`));
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  async function copy() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setMessage("Receipt link copied. Share only with this customer.");
    } catch {
      setMessage("Select the receipt link to copy it.");
    }
  }
  return (
    <section
      className="form"
      aria-label="Customer receipt and billing"
      style={{ marginTop: 24 }}
    >
      <h3>Customer receipt and billing</h3>
      <p className="muted">
        A separate seven-day link shows the receipt and accepts optional billing
        details. It cannot edit the order.
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="secondary"
          disabled={busy}
          onClick={() => manage("POST")}
        >
          {active || link ? "Replace receipt link" : "Create receipt link"}
        </button>
        {(active || link) && (
          <button
            className="text-button danger-text"
            disabled={busy}
            onClick={() => manage("DELETE")}
          >
            Revoke receipt link
          </button>
        )}
      </div>
      {link && (
        <div>
          <label htmlFor="receipt-link">Private receipt link</label>
          <input
            id="receipt-link"
            value={link}
            readOnly
            autoComplete="off"
            spellCheck={false}
            onClick={(e) => e.currentTarget.select()}
          />
          <button className="secondary" onClick={copy}>
            Copy receipt link
          </button>
        </div>
      )}
      <label style={{ display: "flex", gap: 8, alignItems: "start" }}>
        <input
          type="checkbox"
          checked={consent}
          onChange={(e) => setConsent(e.target.checked)}
          style={{ width: "auto" }}
        />
        The customer agreed to receive their receipt by WhatsApp at the phone
        number on this order.
      </label>
      <button
        className="secondary"
        disabled={busy || !consent || status === "PROCESSING"}
        onClick={send}
      >
        Send / resend WhatsApp receipt
      </button>
      <p className="muted">
        {status ? `WhatsApp: ${label(status)}. ` : ""}Resending replaces the
        previous receipt link. An uncertain result may already have sent a
        message; check before retrying.
      </p>
      <button className="secondary" disabled={loading} onClick={loadBilling}>
        {loading ? "Loading…" : "View billing details (owner only)"}
      </button>
      {billing && (
        <div>
          <h4>Billing request</h4>
          {billing.details ? (
            <>
              <p className="muted">
                Details received. Invoice issuance is handled separately.
              </p>
              <dl>
                {Object.entries(billing.details).map(([key, value]) => (
                  <div key={key}>
                    <dt>{label(key)}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <button
                className="text-button"
                onClick={() => setBilling(undefined)}
              >
                Hide billing details
              </button>
            </>
          ) : (
            <p>No billing details submitted.</p>
          )}
        </div>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </section>
  );
}
