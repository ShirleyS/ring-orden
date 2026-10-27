"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Download,
  FileSpreadsheet,
  Loader2,
  UploadCloud,
  X,
} from "lucide-react";
import {
  parseMenuCSV,
  type MenuCSVItem,
  type MenuCSVResult,
} from "./menuCsv.ts";

export interface MenuImportProps {
  onClose: () => void;
  onImport: (items: MenuCSVItem[]) => Promise<void>;
}
const SAMPLE_CSV =
  'name,price,category,description,available\r\nIced Latte,78,Coffee,"House espresso, milk and ice",true\r\nChocolate Croissant,75,Bakery,Buttery pastry with dark chocolate,true\r\nUbe Croissant,80,Bakery,Our signature purple ube cream,false\r\n';
const pesos = (value: number) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    value,
  );

/** Review and validate before the parent persists menu items. */
export function MenuImport({ onClose, onImport }: MenuImportProps) {
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState("");
  const [result, setResult] = useState<MenuCSVResult | null>(null);
  const [stage, setStage] = useState<"source" | "preview">("source");
  const [fileError, setFileError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const headingId = useId();
  const inputId = useId();

  useEffect(() => {
    const priorFocus = document.activeElement as HTMLElement | null;
    const priorOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const first = dialogRef.current?.querySelector<HTMLElement>(
      "button:not([disabled]),textarea",
    );
    first?.focus();
    return () => {
      document.body.style.overflow = priorOverflow;
      priorFocus?.focus();
    };
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]',
      );
      if (!focusable?.length) {
        event.preventDefault();
        return;
      }
      const first = focusable[0],
        last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose, busy]);

  function changeSource(value: string) {
    setSource(value);
    setResult(null);
    setFileError("");
    setSaveError("");
    setStage("source");
  }
  async function loadFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 1_000_000) {
      setFileError("Choose a CSV smaller than 1 MB.");
      setResult(null);
      return;
    }
    try {
      const text = await file.text();
      changeSource(text);
      setFileName(file.name);
    } catch {
      setFileError(
        "This file could not be opened. Try another file or paste its contents.",
      );
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  function preview() {
    const parsed = parseMenuCSV(source);
    setResult(parsed);
    setSaveError("");
    if (!parsed.errors.length && parsed.items.length) setStage("preview");
  }
  async function importItems() {
    if (!result || result.errors.length || !result.items.length || busy) return;
    setBusy(true);
    setSaveError("");
    try {
      await onImport(result.items);
      onClose();
    } catch (error) {
      setSaveError(
        error instanceof Error
          ? error.message
          : "Import stopped. Some items may have been added. Check your menu before trying again.",
      );
    } finally {
      setBusy(false);
    }
  }
  function downloadSample() {
    const url = URL.createObjectURL(
      new Blob([SAMPLE_CSV], { type: "text/csv;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "ring-orden-menu-sample.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <div
      className="modal-backdrop"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className="modal wide"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        onClick={(event) => event.stopPropagation()}
      >
        <header>
          <div>
            <h2 id={headingId}>
              {stage === "preview"
                ? "Review your menu import"
                : "Bring your menu in."}
            </h2>
            <p>
              {stage === "preview"
                ? "Check names, prices and availability before adding these items."
                : "Upload a CSV or paste your menu. You’ll review everything first."}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close menu import"
            disabled={busy}
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <div className="modal-body">
          {stage === "source" ? (
            <div className="form">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <span className="muted">
                  Up to 100 items · MXN prices · 1 MB maximum
                </span>
                <button
                  type="button"
                  className="text-button"
                  onClick={downloadSample}
                >
                  <Download size={14} />
                  Download sample CSV
                </button>
              </div>
              <input
                ref={fileRef}
                id={inputId}
                type="file"
                accept=".csv,text/csv"
                style={{ display: "none" }}
                onChange={(event) => void loadFile(event.target.files?.[0])}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => fileRef.current?.click()}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void loadFile(event.dataTransfer.files[0]);
                }}
                style={{
                  minHeight: 132,
                  display: "flex",
                  flexDirection: "column",
                  whiteSpace: "normal",
                  border:
                    "1px dashed " + (dragging ? "var(--wine)" : "#cbd1c0"),
                  background: dragging ? "#f5ecee" : "#fafbf6",
                  padding: 24,
                  gap: 8,
                }}
              >
                <UploadCloud size={27} style={{ color: "var(--wine)" }} />
                <strong style={{ fontSize: 12 }}>
                  {fileName || "Drop a CSV here, or choose a file"}
                </strong>
                <span className="muted" style={{ fontSize: 10 }}>
                  Columns: name, price, category, description, available
                </span>
              </button>
              <label>
                Or paste CSV
                <textarea
                  aria-label="Menu CSV contents"
                  rows={8}
                  spellCheck={false}
                  value={source}
                  onChange={(event) => {
                    changeSource(event.target.value);
                    setFileName("");
                  }}
                  placeholder={
                    "name,price,category,description,available\nIced Latte,78,Coffee,Espresso over ice,true"
                  }
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: 11,
                    lineHeight: 1.6,
                  }}
                />
              </label>
              <p className="field-help" style={{ lineHeight: 1.7 }}>
                Name and price are required. Prices can be 0–10,000 MXN with up
                to two decimal places. Category defaults to Other and
                availability to available. Imports add new items to your current
                menu.
              </p>
              {fileError || result?.errors.length ? (
                <div
                  role="alert"
                  className="error-banner"
                  style={{ alignItems: "flex-start", margin: 0 }}
                >
                  <AlertCircle size={17} />
                  <div>
                    {fileError ? (
                      <p>{fileError}</p>
                    ) : (
                      <>
                        <strong>Check these rows before importing.</strong>
                        <ul
                          style={{
                            paddingLeft: 16,
                            margin: "8px 0 0",
                            lineHeight: 1.7,
                          }}
                        >
                          {result?.errors.slice(0, 10).map((error, index) => (
                            <li key={index}>{error}</li>
                          ))}
                        </ul>
                        {(result?.errors.length ?? 0) > 10 && (
                          <p style={{ marginTop: 6 }}>
                            And {(result?.errors.length ?? 0) - 10} more errors.
                            Fix the rows above, then preview again.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div className="info-banner" style={{ margin: "0 0 18px" }}>
                <Check size={17} />
                <div>
                  <strong>{result?.items.length} items ready to add</strong>
                  <p>
                    These items have valid prices and no duplicate names within
                    the CSV.
                  </p>
                </div>
              </div>
              <div
                className="table-scroll"
                style={{
                  maxHeight: 340,
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                }}
              >
                <table>
                  <thead>
                    <tr>
                      <th>ITEM</th>
                      <th>CATEGORY</th>
                      <th>PRICE · MXN</th>
                      <th>AVAILABILITY</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result?.items.map((item, index) => (
                      <tr key={index}>
                        <td style={{ whiteSpace: "normal", minWidth: 170 }}>
                          <strong>{item.name}</strong>
                          {item.description && (
                            <span
                              style={{
                                display: "block",
                                fontSize: 10,
                                lineHeight: 1.5,
                                marginTop: 4,
                                color: "var(--muted)",
                                whiteSpace: "pre-wrap",
                              }}
                            >
                              {item.description}
                            </span>
                          )}
                        </td>
                        <td>{item.category}</td>
                        <td>{pesos(item.price)}</td>
                        <td>
                          <span
                            className={
                              "badge " + (item.available ? "green" : "neutral")
                            }
                          >
                            {item.available ? "Available" : "Sold out"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {saveError && (
                <div
                  className="error-banner"
                  role="alert"
                  style={{ margin: "18px 0 0", alignItems: "flex-start" }}
                >
                  <AlertCircle size={17} />
                  <p style={{ lineHeight: 1.7 }}>{saveError}</p>
                </div>
              )}
            </>
          )}
        </div>
        <footer className="modal-footer">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() =>
              stage === "preview"
                ? (setStage("source"), setSaveError(""))
                : onClose()
            }
          >
            {stage === "preview" ? (
              <>
                <ArrowLeft size={14} />
                Edit CSV
              </>
            ) : (
              "Cancel"
            )}
          </button>
          {stage === "source" ? (
            <button
              type="button"
              className="primary"
              disabled={!source.trim() || !!fileError}
              onClick={preview}
            >
              <FileSpreadsheet size={15} />
              Preview import
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy || !!saveError}
              onClick={() => void importItems()}
            >
              {busy ? (
                <>
                  <Loader2 size={15} className="spin" />
                  Adding menu items…
                </>
              ) : (
                <>
                  <Check size={15} />
                  Add {result?.items.length} items
                </>
              )}
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
export default MenuImport;
