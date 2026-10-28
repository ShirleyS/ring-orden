"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Loader2,
  RotateCcw,
} from "lucide-react";
import { api, type MenuImportSummary } from "./types";

export default function MenuUploadHistory({
  imports,
  onChanged,
}: {
  imports: MenuImportSummary[];
  onChanged: () => Promise<void>;
}) {
  const headingId = useId();
  const confirmationId = useId();
  const confirmationRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState<{
    id: string;
    action: "unload" | "restore";
    requestId: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const target = imports.find((entry) => entry.id === pending?.id);
  const pendingIsCurrent =
    target &&
    (pending?.action === "unload"
      ? target.status === "active"
      : target.status === "unloaded");
  useEffect(() => {
    if (pending) confirmationRef.current?.focus();
  }, [pending]);

  async function confirmChange() {
    if (!pending || !target || !pendingIsCurrent || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ count: number }>(
        `/menu/imports/${encodeURIComponent(target.id)}/${pending.action}`,
        "POST",
        { request_id: pending.requestId },
      );
      setSuccess(
        `${result.count} ${result.count === 1 ? "product" : "products"} ${pending.action === "unload" ? "unloaded from" : "restored to"} your menu.`,
      );
      setPending(null);
      await onChanged();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "This upload could not be updated. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel menu-upload-history" aria-labelledby={headingId}>
      <div className="menu-upload-history-heading">
        <div>
          <span className="eyebrow">YOUR MENU OVER TIME</span>
          <h2 id={headingId}>Upload history</h2>
          <p>
            Unload an upload’s products together, or restore them when you need
            them again. Manually added products and past orders stay in place.
          </p>
        </div>
        <Archive size={22} aria-hidden="true" />
      </div>
      {!imports.length ? (
        <p className="menu-photo-note">
          Your photo and CSV uploads will appear here. Earlier uploads without a
          saved record may only appear in your product list.
        </p>
      ) : (
        <ul className="menu-upload-list">
          {imports.map((entry) => (
            <li key={entry.id}>
              <div className="menu-upload-details">
                <strong>{entry.label}</strong>
                <p>
                  {entry.created_at
                    ? new Date(entry.created_at).toLocaleString(undefined, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })
                    : "Earlier upload"}{" "}
                  · {entry.product_count}{" "}
                  {entry.product_count === 1 ? "product" : "products"}
                  {entry.status === "active" &&
                  entry.active_count !== entry.product_count
                    ? ` · ${entry.active_count} currently in menu`
                    : ""}
                </p>
              </div>
              <span
                className={`badge ${entry.status === "active" ? "green" : "neutral"}`}
              >
                {entry.status === "active" ? "Active" : "Unloaded"}
              </span>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                aria-label={`${entry.status === "active" ? "Unload" : "Restore"} ${entry.label}`}
                aria-expanded={pending?.id === entry.id}
                aria-controls={
                  pending?.id === entry.id ? confirmationId : undefined
                }
                onClick={() => {
                  setPending({
                    id: entry.id,
                    action: entry.status === "active" ? "unload" : "restore",
                    requestId: crypto.randomUUID(),
                  });
                  setError("");
                  setSuccess("");
                }}
              >
                {entry.status === "active" ? (
                  <Archive size={14} />
                ) : (
                  <RotateCcw size={14} />
                )}
                {entry.status === "active" ? "Unload" : "Restore"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending && target && (
        <div
          ref={confirmationRef}
          tabIndex={-1}
          className="menu-upload-confirmation"
          id={confirmationId}
          role="group"
          aria-label={`Confirm ${pending.action}`}
        >
          <strong>
            {pending.action === "unload"
              ? `Unload ${target.active_count} current products from “${target.label}”?`
              : `Restore ${target.product_count} products from “${target.label}”?`}
          </strong>
          <p>
            {pending.action === "unload"
              ? "These products will leave your active menu and can be restored later. Manually added products and past orders stay in place."
              : "Products return with their saved names, prices and availability. Resolve any duplicate names before restoring."}
          </p>
          {!pendingIsCurrent && (
            <p role="alert">
              This upload has changed. Choose its current action above to
              continue.
            </p>
          )}
          <div className="menu-upload-confirm-actions">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => {
                setPending(null);
                setError("");
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy || !pendingIsCurrent}
              onClick={() => void confirmChange()}
            >
              {busy && <Loader2 size={15} className="menu-photo-spinner" />}
              {busy
                ? "Updating menu…"
                : pending.action === "unload"
                  ? "Confirm unload"
                  : "Restore products"}
            </button>
          </div>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} />
          <p>{error}</p>
        </div>
      )}
      {success && (
        <div className="info-banner" role="status">
          <CheckCircle2 size={17} />
          <p>{success}</p>
        </div>
      )}
    </section>
  );
}
