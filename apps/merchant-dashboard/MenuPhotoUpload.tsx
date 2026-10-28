"use client";
import { useEffect, useId, useRef, useState } from "react";
import {
  ImagePlus,
  UploadCloud,
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { api, type MenuImportSummary } from "./types";
import { supabaseAccessToken } from "./supabase-auth";

type Draft = {
  name: string;
  price: number | null;
  category: string;
  description: string;
  available: boolean;
};
type Row = Omit<Draft, "price"> & {
  price: string;
  included: boolean;
  selectionManual: boolean;
};
type Extraction = {
  items: Draft[];
  warnings: string[];
  currency: string;
  id: string;
  label: string;
  created_at: string;
};

async function normalizePhoto(file: File): Promise<Blob> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("Choose a JPG, PNG or WebP menu photo.");
  if (file.size > 6 * 1024 * 1024)
    throw new Error(
      "Choose a photo smaller than 6 MB, or crop it to one menu page.",
    );
  const image = await createImageBitmap(file);
  try {
    if (image.width * image.height > 48_000_000)
      throw new Error("Crop this photo to one menu page and try again.");
    const scale = Math.min(1, 4096 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not open the photo.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("This photo could not be prepared. Try a JPG.")),
        "image/jpeg",
        0.94,
      ),
    );
    if (blob.size > 3 * 1024 * 1024)
      throw new Error(
        "Crop this photo to one menu page so the text stays sharp.",
      );
    return blob;
  } finally {
    image.close();
  }
}
export default function MenuPhotoUpload({
  currency,
  existingProducts,
  imports,
  onImported,
}: {
  currency: string;
  existingProducts: { id: string; name: string }[];
  imports: MenuImportSummary[];
  onImported: (count: number) => Promise<void>;
}) {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<{
    message: string;
    remaining_credits: number | null;
  } | null>(null);
  async function checkConnection() {
    setChecking(true);
    setError("");
    setConnection(null);
    try {
      const result = await api<{
        message: string;
        remaining_credits: number | null;
      }>("/integrations/firecrawl/test", "POST", {});
      setConnection(result);
      setConfigured(true);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Connection check failed. Try again.",
      );
    } finally {
      setChecking(false);
    }
  }
  const [drafts, setDrafts] = useState<Extraction[]>([]);
  const [draftId, setDraftId] = useState<string>();
  function resumeDraft(data: Extraction) {
    const seen = new Set(existingProducts.map((item) => key(item.name)));
    setRows(
      data.items.map((item) => {
        const duplicate = seen.has(key(item.name));
        seen.add(key(item.name));
        return {
          ...item,
          price: item.price === null ? "" : String(item.price),
          included: !duplicate && item.price !== null,
          selectionManual: false,
        };
      }),
    );
    setDraftId(data.id);
    setFileName(data.label);
    setWarnings(data.warnings);
    setRequestId(crypto.randomUUID());
    setImportMode("add");
    setReplaceIds([]);
    setConfirmReplacement(false);
    setSuccess(null);
    setPreview("");
  }
  const [rows, setRows] = useState<Row[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"reading" | "saving" | null>(null);
  const [dragging, setDragging] = useState(false);
  const [preview, setPreview] = useState("");
  const [fileName, setFileName] = useState("");
  const [success, setSuccess] = useState<number | null>(null);
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [importMode, setImportMode] = useState("add");
  const [replaceIds, setReplaceIds] = useState<string[]>([]);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const modeId = useId();
  const confirmationRef = useRef<HTMLDivElement>(null);
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    if (confirmReplacement) confirmationRef.current?.focus();
  }, [confirmReplacement]);
  useEffect(() => {
    let active = true;
    api<{ drafts: Extraction[] }>("/menu/image/drafts")
      .then((result) => {
        if (active) setDrafts(result.drafts);
      })
      .catch(() => {
        if (active)
          setError(
            "Saved menu drafts could not be loaded. Refresh to try again.",
          );
      });
    api<{ configured: boolean }>("/menu/image/status")
      .then((result) => {
        if (active) setConfigured(result.configured);
      })
      .catch(() => {
        if (active) setConfigured(null);
      });
    return () => {
      active = false;
      request.current?.abort();
    };
  }, []);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  const key = (name: string) =>
    name.trim().normalize("NFC").toLocaleLowerCase();
  const activeImports = imports.filter((entry) => entry.status === "active");
  const replacements = activeImports.filter((entry) =>
    replaceIds.includes(entry.id),
  );
  const replacedItemIds = new Set(
    replacements.flatMap((entry) => entry.item_ids),
  );
  const replacedCount = replacements.reduce(
    (count, entry) => count + entry.active_count,
    0,
  );
  const allSelectionChanged =
    importMode === "all" &&
    (activeImports.length !== replaceIds.length ||
      activeImports.some((entry) => !replaceIds.includes(entry.id)));
  const existing = new Set(
    existingProducts
      .filter((item) => !replacedItemIds.has(item.id))
      .map((item) => key(item.name)),
  );
  const selected = rows.filter((row) => row.included);
  const selectedNames = new Set<string>();
  let validation = "";
  for (const row of selected) {
    if (!row.name.trim() || !row.category.trim())
      validation = "Enter a name and category for every selected product.";
    if (
      !row.price.trim() ||
      !Number.isFinite(Number(row.price)) ||
      Number(row.price) < 0 ||
      Number(row.price) > 100000
    )
      validation = "Enter a readable price for every selected product.";
    const name = key(row.name);
    if (existing.has(name) || selectedNames.has(name))
      validation = `${row.name || "This product"} is already in your menu or selected twice. Uncheck it or change its name.`;
    selectedNames.add(name);
  }
  if (
    importMode !== "add" &&
    (!replaceIds.length || replacements.length !== replaceIds.length)
  )
    validation =
      "This upload selection has changed. Choose the uploads to replace again.";
  if (allSelectionChanged)
    validation =
      "Your active uploads have changed. Update the selection before replacing them.";
  function changeMode(mode: string) {
    const ids =
      mode === "add"
        ? []
        : mode === "all"
          ? activeImports.map((entry) => entry.id)
          : [mode.slice("upload:".length)];
    const excluded = new Set(
      activeImports
        .filter((entry) => ids.includes(entry.id))
        .flatMap((entry) => entry.item_ids),
    );
    const seen = new Set(
      existingProducts
        .filter((item) => !excluded.has(item.id))
        .map((item) => key(item.name)),
    );
    setRows((prior) =>
      prior.map((row) => {
        const included = row.selectionManual
          ? row.included
          : !!row.price.trim() && !seen.has(key(row.name));
        if (included) seen.add(key(row.name));
        return { ...row, included };
      }),
    );
    setImportMode(mode);
    setReplaceIds(ids);
    setConfirmReplacement(false);
    setRequestId(crypto.randomUUID());
    setError("");
  }
  function update(index: number, changes: Partial<Row>) {
    setRows((prior) =>
      prior.map((row, i) =>
        i === index
          ? {
              ...row,
              ...changes,
              selectionManual:
                changes.included !== undefined ? true : row.selectionManual,
            }
          : row,
      ),
    );
    setConfirmReplacement(false);
    setRequestId(crypto.randomUUID());
    setError("");
  }
  async function readPhoto(file: File | undefined) {
    if (!file || busy || checking) return;
    setError("");
    setSuccess(null);
    if (connection?.remaining_credits === 0) {
      setError(
        "Firecrawl has no credits left. Add credits to read menu photos.",
      );
      return;
    }
    if (configured === false) {
      setError(
        "Menu photo reading needs Firecrawl setup in your hosting settings.",
      );
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy("reading");
    setRows([]);
    setWarnings([]);
    setImportMode("add");
    setReplaceIds([]);
    setConfirmReplacement(false);
    try {
      const blob = await normalizePhoto(file);
      if (controller.signal.aborted) return;
      setPreview(URL.createObjectURL(file));
      setFileName(file.name);
      const form = new FormData();
      form.set("file", blob, file.name);
      const token = await supabaseAccessToken();
      const response = await fetch("/api/menu/image/preview", {
        method: "POST",
        credentials: "same-origin",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: form,
        signal: AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(60000),
        ]),
      });
      const result = (await response.json()) as Extraction & { error?: string };
      if (!response.ok)
        throw new Error(
          result.error || "This menu could not be read. Try a clearer photo.",
        );
      const data = result as Extraction;
      resumeDraft(data);
      setDrafts((prior) => [
        data,
        ...prior.filter((draft) => draft.id !== data.id),
      ]);
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Menu reading failed. Try again.",
        );
    } finally {
      if (!controller.signal.aborted) setBusy(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  async function addProducts() {
    if (busy || validation || !selected.length) return;
    if (replaceIds.length && !confirmReplacement) {
      setConfirmReplacement(true);
      return;
    }
    setBusy("saving");
    setError("");
    try {
      const result = await api<{ count: number }>("/menu/import", "POST", {
        request_id: requestId,
        source: "photo",
        draft_id: draftId,
        label: fileName.slice(0, 180),
        replace_import_ids: replaceIds,
        items: selected.map((row) => ({
          name: row.name.trim(),
          category: row.category.trim(),
          price: Number(row.price),
          description: row.description,
          available: true,
        })),
      });
      setRows([]);
      setWarnings([]);
      setPreview("");
      setSuccess(result.count);
      setDrafts((prior) => prior.filter((draft) => draft.id !== draftId));
      setDraftId(undefined);
      setConfirmReplacement(false);
      setImportMode("add");
      setReplaceIds([]);
      await onImported(result.count);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Products could not be added. Please try again.",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <section
      className="panel menu-photo-section"
      aria-labelledby="menu-photo-title"
    >
      <div className="menu-photo-heading">
        <div>
          <span className="eyebrow">FROM PHOTO TO PHONE ORDERS</span>
          <h2 id="menu-photo-title">Your menu, ready in a photo.</h2>
          <p>
            Drop in a menu photo. We’ll read the products and prices, then you
            review what gets added.
          </p>
        </div>
        <div className="menu-photo-connection">
          <span className="menu-photo-provider">Read with Firecrawl</span>
          <button
            type="button"
            className="text-button"
            disabled={!!busy || checking}
            onClick={() => void checkConnection()}
          >
            {checking ? "Checking connection…" : "Check connection"}
          </button>
        </div>
      </div>
      {drafts.length > 0 && (
        <div className="info-banner">
          <label>
            Saved menu drafts
            <select
              aria-label="Resume a saved menu draft"
              value={draftId ?? ""}
              disabled={!!busy}
              onChange={(event) => {
                const draft = drafts.find(
                  (entry) => entry.id === event.target.value,
                );
                if (draft) resumeDraft(draft);
              }}
            >
              <option value="">Choose a draft to review</option>
              {drafts.map((draft) => (
                <option key={draft.id} value={draft.id}>
                  {draft.label} · {new Date(draft.created_at).toLocaleString()}
                </option>
              ))}
            </select>
          </label>
          <p>
            Extracted results are saved. Resume them here after returning to
            this page.
          </p>
        </div>
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp"
        aria-label="Choose a menu photo"
        hidden
        onChange={(event) => void readPhoto(event.target.files?.[0])}
      />
      <button
        type="button"
        className={"menu-photo-drop " + (dragging ? "dragging" : "")}
        disabled={!!busy || checking}
        onClick={() => fileInput.current?.click()}
        onDragOver={(event) => {
          event.preventDefault();
          if (!busy) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          if (event.dataTransfer.files.length !== 1) {
            setError("Drop one menu photo at a time.");
            return;
          }
          void readPhoto(event.dataTransfer.files[0]);
        }}
      >
        {busy === "reading" ? (
          <Loader2 size={28} className="menu-photo-spinner" />
        ) : (
          <UploadCloud size={28} />
        )}
        <strong>
          {busy === "reading"
            ? "Reading names and prices…"
            : "Drop a menu photo here, or choose an image"}
        </strong>
        <span>JPG, PNG or WebP · Up to 6 MB · One menu page at a time</span>
      </button>
      {connection && (
        <div className="info-banner" role="status">
          <CheckCircle2 size={17} />
          <p>
            {connection.message}
            {connection.remaining_credits !== null && (
              <strong>
                {" "}
                {connection.remaining_credits.toLocaleString()} credits
                remaining.
              </strong>
            )}
          </p>
        </div>
      )}
      {configured === false && (
        <p className="menu-photo-note">
          Menu photo reading needs a Firecrawl connection. Add FIRECRAWL_API_KEY
          to this site’s hosting settings.
        </p>
      )}
      {success !== null && (
        <div className="info-banner" role="status">
          <CheckCircle2 size={18} />
          <p>
            <strong>{success} products added.</strong> They’re now available in
            your menu and to your ordering agent.
          </p>
        </div>
      )}
      {error && (
        <div className="error-banner" role="alert">
          <AlertCircle size={17} />
          <p>{error}</p>
        </div>
      )}
      {preview && (
        <div className="menu-photo-source">
          <img src={preview} alt="The menu photo being reviewed" />
          <div>
            <strong>{fileName}</strong>
            <p>
              {busy === "reading"
                ? "Reading this photo. You can review the results before anything is added."
                : "Compare every name and price with your original photo."}
            </p>
            <a href={preview} target="_blank" rel="noreferrer">
              View full photo
            </a>
          </div>
          {!busy && (
            <button
              type="button"
              className="icon-button"
              aria-label="Clear menu photo"
              onClick={() => {
                setPreview("");
                setRows([]);
                setWarnings([]);
                setError("");
              }}
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}
      {!!rows.length && (
        <div className="menu-photo-review">
          <div className="menu-photo-review-heading">
            <h3>Review {rows.length} products</h3>
            <span>Prices in {currency}</span>
          </div>
          <div className="menu-photo-import-mode">
            <label htmlFor={modeId}>
              How should this photo update your menu?
            </label>
            <select
              id={modeId}
              value={importMode}
              disabled={!!busy}
              onChange={(event) => changeMode(event.target.value)}
            >
              <option value="add">Add products</option>
              <option value="all" disabled={!activeImports.length}>
                Replace all active uploads
              </option>
              {activeImports.map((entry) => (
                <option key={entry.id} value={`upload:${entry.id}`}>
                  Replace {entry.label} ({entry.active_count} products)
                </option>
              ))}
              {importMode.startsWith("upload:") &&
                !activeImports.some(
                  (entry) => `upload:${entry.id}` === importMode,
                ) && (
                  <option value={importMode}>Upload no longer active</option>
                )}
            </select>
            <p>
              {replaceIds.length
                ? `Unload ${replacedCount} current products from ${replacements.map((entry) => `“${entry.label}”`).join(", ")} and add ${selected.length} reviewed products. Manually added products and past orders stay in place. You can restore the old upload later.`
                : "Add selected products alongside your current menu."}
            </p>
            {allSelectionChanged && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => changeMode("all")}
              >
                Update selection
              </button>
            )}
          </div>
          {warnings.map((warning, i) => (
            <p className="menu-photo-warning" key={i}>
              {warning}
            </p>
          ))}
          <p className="menu-photo-note">
            Choose what to add. Unclear prices and products already in the
            remaining menu start unchecked. Your name and price edits stay when
            you change the upload selection.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>INCLUDE</th>
                  <th>PRODUCT NAME</th>
                  <th>CATEGORY</th>
                  <th>PRICE · {currency}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={index}
                    className={row.included ? "" : "menu-photo-excluded"}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Include ${row.name || "product " + (index + 1)}`}
                        checked={row.included}
                        disabled={!!busy}
                        onChange={(event) =>
                          update(index, { included: event.target.checked })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Product name ${index + 1}`}
                        value={row.name}
                        maxLength={120}
                        disabled={!!busy}
                        onChange={(event) =>
                          update(index, { name: event.target.value })
                        }
                      />
                      {existing.has(key(row.name)) && (
                        <small>Already in your menu</small>
                      )}
                      {row.description && <small>{row.description}</small>}
                    </td>
                    <td>
                      <input
                        aria-label={`Category ${index + 1}`}
                        value={row.category}
                        maxLength={80}
                        disabled={!!busy}
                        onChange={(event) =>
                          update(index, { category: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Price ${index + 1} in ${currency}`}
                        type="number"
                        min="0"
                        max="100000"
                        step="0.01"
                        inputMode="decimal"
                        value={row.price}
                        placeholder="Check price"
                        disabled={!!busy}
                        onChange={(event) =>
                          update(index, { price: event.target.value })
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {validation && (
            <p className="menu-photo-warning" role="alert">
              {validation}
            </p>
          )}
          {confirmReplacement && !validation && (
            <div
              ref={confirmationRef}
              tabIndex={-1}
              className="menu-upload-confirmation"
              role="group"
              aria-label="Confirm upload replacement"
            >
              <strong>
                Replace {replacedCount} current products with {selected.length}{" "}
                reviewed products?
              </strong>
              <p>
                Products from{" "}
                {replacements.map((entry) => `“${entry.label}”`).join(", ")}{" "}
                will leave your active menu. Manually added products and past
                orders stay in place. The old uploads remain in history so you
                can restore them later.
              </p>
              <div className="menu-upload-confirm-actions">
                <button
                  type="button"
                  className="secondary"
                  disabled={!!busy}
                  onClick={() => setConfirmReplacement(false)}
                >
                  Cancel replacement
                </button>
                <button
                  type="button"
                  className="primary"
                  disabled={!!busy || !selected.length}
                  onClick={() => void addProducts()}
                >
                  {busy === "saving" && (
                    <Loader2 size={16} className="menu-photo-spinner" />
                  )}
                  {busy === "saving"
                    ? "Replacing products…"
                    : `Confirm replacement · ${selected.length} products`}
                </button>
              </div>
            </div>
          )}
          <div className="menu-photo-actions">
            <p>
              Review every price. Selected products will be marked available.
            </p>
            {!confirmReplacement && (
              <button
                type="button"
                className="primary"
                disabled={!!busy || !!validation || !selected.length}
                onClick={() => void addProducts()}
              >
                {busy === "saving" ? (
                  <>
                    <Loader2 size={16} className="menu-photo-spinner" />
                    {replaceIds.length
                      ? "Replacing products…"
                      : "Adding products…"}
                  </>
                ) : (
                  <>
                    <ImagePlus size={16} />
                    {replaceIds.length
                      ? "Review replacement"
                      : `Add ${selected.length} ${selected.length === 1 ? "product" : "products"} to menu`}
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
