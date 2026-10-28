"use client";
import React, { useEffect, useRef, useState } from "react";
import { AudioLines, CheckCircle2, Loader2, ShieldCheck } from "lucide-react";
import { money, Obj } from "./types";

declare global {
  interface ImportMetaEnv {
    readonly VITE_CUSTOMER_API_ORIGIN?: string;
  }
}

const emptyBilling = {
  rfc: "",
  legal_name: "",
  postal_code: "",
  tax_regime: "",
  cfdi_use: "",
  email: "",
};
const statusNames: Record<string, string> = {
  DRAFT: "Borrador",
  AWAITING_CLARIFICATION: "Pendiente de aclaración",
  AWAITING_CONFIRMATION: "Pendiente de confirmación",
  PAYMENT_PENDING: "Pendiente de pago",
  PENDING: "Pendiente",
  PAID: "Pagado",
  PREPARING: "En preparación",
  READY: "Listo",
  COMPLETED: "Completado",
  CANCELLED: "Cancelado",
  REFUNDED: "Reembolsado",
  FAILED: "No completado",
  FAILED_PERMANENT: "No completado",
  SENT: "Enviado",
};
const statusName = (value?: string) =>
  statusNames[value || ""] || "Por confirmar";
const fields = [
  {
    key: "rfc",
    title: "RFC",
    max: 13,
    pattern: "[A-Za-zÑñ&]{3,4}[0-9]{6}[A-Za-z0-9]{3}",
    hint: "12 o 13 caracteres",
  },
  {
    key: "legal_name",
    title: "Nombre o razón social",
    max: 200,
    hint: "Como aparece en tu constancia fiscal",
  },
  {
    key: "postal_code",
    title: "Código postal fiscal",
    max: 5,
    pattern: "[0-9]{5}",
    hint: "5 dígitos",
  },
  {
    key: "tax_regime",
    title: "Régimen fiscal",
    max: 3,
    pattern: "[0-9]{3}",
    hint: "Clave de 3 dígitos",
  },
  {
    key: "cfdi_use",
    title: "Uso de CFDI",
    max: 3,
    pattern: "[A-Za-z][0-9]{2}",
    hint: "Clave, por ejemplo G03",
  },
  {
    key: "email",
    title: "Correo electrónico (opcional)",
    max: 254,
    hint: "Opcional, para comunicaciones de facturación",
  },
] as const;

function configuredApiOrigin() {
  const configured = import.meta.env.VITE_CUSTOMER_API_ORIGIN;
  if (!configured) return "";
  const parsed = new URL(configured);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
    parsed.hostname,
  );
  if (
    (parsed.protocol !== "https:" &&
      !(loopback && parsed.protocol === "http:")) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    throw new Error(
      "El servicio de atención no está configurado. Contacta al restaurante.",
    );
  return parsed.origin;
}

/** Capability credentials stay in memory; customer requests never use merchant sessions. */
export default function CustomerForms() {
  const [link, setLink] = useState({ token: "", purpose: "" });
  const [ready, setReady] = useState(false);
  const capturedLink = useRef(false);
  const linkGeneration = useRef(0);
  const [data, setData] = useState<Obj | null>(null);
  const [billing, setBilling] = useState(emptyBilling);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [verified, setVerified] = useState(false);
  const validLink =
    /^[A-Za-z0-9_-]{80,2000}$/.test(link.token) &&
    ["receipt", "billing", "verify"].includes(link.purpose);

  const request = async (
    purpose: string,
    method = "GET",
    body?: unknown,
    signal?: AbortSignal,
  ) => {
    const response = await fetch(
      `${configuredApiOrigin()}/api/customer/${purpose}`,
      {
        method,
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        headers: {
          "Content-Type": "application/json",
          ...(purpose !== "verify"
            ? { Authorization: `Bearer ${link.token}` }
            : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal,
      },
    );
    const payload = (await response.json()) as Obj;
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "El enlace no es válido, venció o fue reemplazado. Solicita uno nuevo al restaurante."
          : response.status === 422
            ? "Revisa los datos e intenta de nuevo."
            : payload.error?.message ||
              payload.error ||
              payload.message ||
              "No pudimos completar la solicitud. Intenta de nuevo.",
      );
    return payload as Obj;
  };

  useEffect(() => {
    const capture = () => {
      capturedLink.current = true;
      linkGeneration.current += 1;
      setLink({
        token: window.location.hash.slice(1),
        purpose:
          new URLSearchParams(window.location.search).get("purpose") || "",
      });
      setData(null);
      setBilling(emptyBilling);
      setSaved(false);
      setVerified(false);
      setError("");
      setConfirmed(false);
      setBusy(false);
      setLoading(false);
      setReady(true);
      // Fragment changes can reuse this page; clear the previous customer's state.
      // Remove the credential from the address/history after capturing it in memory.
      if (window.location.hash)
        window.history.replaceState(
          null,
          "",
          window.location.pathname + window.location.search,
        );
    };
    if (!capturedLink.current) capture();
    window.addEventListener("hashchange", capture);
    return () => window.removeEventListener("hashchange", capture);
  }, []);

  useEffect(() => {
    if (!validLink || link.purpose === "verify") return;
    const controller = new AbortController();
    const generation = linkGeneration.current;
    setLoading(true);
    request(link.purpose, "GET", undefined, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted && generation === linkGeneration.current)
          setData(payload);
      })
      .catch((e) => {
        if (!controller.signal.aborted && generation === linkGeneration.current)
          setError((e as Error).message);
      })
      .finally(() => {
        if (!controller.signal.aborted && generation === linkGeneration.current)
          setLoading(false);
      });
    return () => controller.abort();
  }, [link, validLink]);

  const expired =
    !!data?.expires_at && Date.parse(data.expires_at) <= Date.now();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !validLink ||
      busy ||
      expired ||
      (link.purpose === "billing" && !confirmed)
    )
      return;
    setBusy(true);
    setError("");
    const generation = linkGeneration.current;
    try {
      const response = await request(
        link.purpose,
        "POST",
        link.purpose === "verify"
          ? { token: link.token }
          : {
              ...billing,
              rfc: billing.rfc.trim().toUpperCase(),
              cfdi_use: billing.cfdi_use.trim().toUpperCase(),
              confirmed: true,
            },
      );
      if (generation !== linkGeneration.current) return;
      if (link.purpose === "verify") {
        if (response.verified !== true)
          throw new Error(
            "No se pudo confirmar tu identidad. Solicita un enlace nuevo.",
          );
        setVerified(true);
      } else {
        if (response.saved !== true || response.status !== "ON_FILE")
          throw new Error(
            "No se confirmó el guardado de los datos. Intenta de nuevo.",
          );
        setSaved(true);
        setBilling(emptyBilling);
        setConfirmed(false);
      }
    } catch (e) {
      if (generation === linkGeneration.current) setError((e as Error).message);
    } finally {
      if (generation === linkGeneration.current) setBusy(false);
    }
  };
  const order = data?.order;
  const currency = order?.currency || data?.merchant?.currency || "MXN";
  const title =
    link.purpose === "receipt"
      ? "Tu comprobante"
      : link.purpose === "verify"
        ? "Verifica tu identidad"
        : "Datos de facturación";

  return (
    <main
      style={{ maxWidth: 740, margin: "40px auto", padding: "0 20px 40px" }}
    >
      <div className="brand" style={{ marginBottom: 32 }}>
        <span className="brand-symbol">
          <AudioLines size={24} />
        </span>
        <span>
          ring<span className="brand-light">orden</span>
          <span className="brand-dot">.</span>
        </span>
      </div>
      <div className="page-head">
        <div>
          <div className="eyebrow">
            {data?.merchant?.name || "ATENCIÓN AL CLIENTE"}
          </div>
          <h1>{title}</h1>
          <p>
            {link.purpose === "receipt"
              ? "Consulta el resumen y el estado de tu pedido."
              : link.purpose === "verify"
                ? "Confirma este enlace para continuar con tu solicitud."
                : "Guarda tus datos fiscales de forma segura con el restaurante."}
          </p>
        </div>
      </div>
      <section className="panel">
        <div className="panel-body">
          {!ready ? (
            <p role="status">Cargando…</p>
          ) : !validLink ? (
            <div role="alert">
              <h3>Este enlace no es válido</h3>
              <p>
                Abre el enlace completo que te compartió el restaurante. Si
                venció, solicita uno nuevo.
              </p>
            </div>
          ) : (
            <>
              {error && (
                <div className="error-banner" role="alert">
                  {error}
                </div>
              )}
              {loading && (
                <p role="status">
                  <Loader2 className="spin" size={18} /> Cargando…
                </p>
              )}
              {expired && (
                <p role="alert">
                  El enlace venció. Solicita uno nuevo al restaurante.
                </p>
              )}
              {link.purpose === "receipt" && order && !expired && (
                <>
                  <h3>Pedido {order.reference || ""}</h3>
                  <p>
                    Estado: {statusName(order.status)} · Pago:{" "}
                    {statusName(order.payment_status)}
                  </p>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>PRODUCTO</th>
                          <th>CANTIDAD</th>
                          <th>PRECIO UNITARIO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(Array.isArray(order.items) ? order.items : []).map(
                          (item: Obj, index: number) => (
                            <tr key={index}>
                              <td>
                                {item.name}
                                {Array.isArray(item.modifiers) &&
                                  item.modifiers.length > 0 && (
                                    <small className="cell-sub">
                                      {item.modifiers
                                        .map((modifier: Obj) => modifier.name)
                                        .join(", ")}
                                    </small>
                                  )}
                              </td>
                              <td>{item.quantity}</td>
                              <td>
                                {typeof item.unit_price === "number"
                                  ? money(
                                      item.unit_price +
                                        (Array.isArray(item.modifiers)
                                          ? item.modifiers.reduce(
                                              (sum: number, modifier: Obj) =>
                                                sum +
                                                (typeof modifier.price_delta ===
                                                "number"
                                                  ? modifier.price_delta
                                                  : 0),
                                              0,
                                            )
                                          : 0),
                                      currency,
                                    )
                                  : "—"}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ display: "grid", gap: 10, marginTop: 22 }}>
                    {[
                      ["Subtotal", order.subtotal],
                      ["Impuestos", order.tax],
                      ["Cargos", order.fees],
                      ["Total", order.total],
                    ].map(
                      ([name, amount]) =>
                        typeof amount === "number" && (
                          <div
                            key={String(name)}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                            }}
                          >
                            <strong>{name}</strong>
                            <span>{money(amount, currency)}</span>
                          </div>
                        ),
                    )}
                  </div>
                  <p className="field-help" style={{ marginTop: 20 }}>
                    Este comprobante resume tu pedido. La emisión de una factura
                    fiscal requiere confirmación del proveedor de facturación.
                  </p>
                </>
              )}
              {link.purpose === "billing" &&
                data &&
                !expired &&
                (saved || data.status === "ON_FILE" ? (
                  <div role="status">
                    <CheckCircle2 size={24} />
                    <h3>Datos guardados</h3>
                    <p>
                      El restaurante recibió tus datos de facturación. La
                      factura fiscal queda pendiente de emisión y confirmación
                      del proveedor.
                    </p>
                  </div>
                ) : (
                  <form className="form" onSubmit={submit}>
                    <div className="form-grid">
                      {fields.map((field) => (
                        <label key={field.key}>
                          {field.title}
                          <input
                            name={field.key}
                            required={field.key !== "email"}
                            type={field.key === "email" ? "email" : "text"}
                            maxLength={field.max}
                            pattern={
                              "pattern" in field ? field.pattern : undefined
                            }
                            title={field.hint}
                            placeholder={field.hint}
                            autoComplete={
                              field.key === "email" ? "email" : "off"
                            }
                            value={billing[field.key]}
                            disabled={busy}
                            onChange={(event) =>
                              setBilling({
                                ...billing,
                                [field.key]: event.target.value,
                              })
                            }
                          />
                        </label>
                      ))}
                    </div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={confirmed}
                        disabled={busy}
                        onChange={(event) => setConfirmed(event.target.checked)}
                      />
                      Confirmo que estos datos son correctos y autorizo
                      guardarlos para facturación.
                    </label>
                    <p className="field-help">
                      <ShieldCheck size={14} /> Tus datos fiscales no se
                      muestran en este enlace después de guardarlos.
                    </p>
                    <div className="form-actions">
                      <button
                        className="primary"
                        type="submit"
                        disabled={busy || !confirmed}
                      >
                        {busy ? "Guardando…" : "Guardar datos fiscales"}
                      </button>
                    </div>
                  </form>
                ))}
              {link.purpose === "verify" &&
                (verified ? (
                  <div role="status">
                    <CheckCircle2 size={24} />
                    <h3>Identidad verificada</h3>
                    <p>
                      Puedes volver a la llamada y continuar con tu solicitud.
                    </p>
                  </div>
                ) : (
                  <form className="form" onSubmit={submit}>
                    <p>
                      Continúa si solicitaste verificar tu identidad con el
                      restaurante.
                    </p>
                    <button className="primary" type="submit" disabled={busy}>
                      {busy ? "Verificando…" : "Verificar mi identidad"}
                    </button>
                  </form>
                ))}
              {data?.expires_at && !expired && (
                <p className="field-help" style={{ marginTop: 20 }}>
                  Disponible hasta{" "}
                  {new Date(data.expires_at).toLocaleString("es-MX", {
                    timeZone: "America/Mexico_City",
                  })}{" "}
                  (Ciudad de México).
                </p>
              )}
            </>
          )}
        </div>
      </section>
    </main>
  );
}
