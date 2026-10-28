"use client";
import React, { useCallback, useEffect, useState } from "react";
import {
  ArrowLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Users,
} from "lucide-react";
import { api, label, money, Obj } from "./types";

const languages = [
  ["es-MX", "Español (México)"],
  ["en-US", "English"],
  ["zh-CN", "中文"],
];
const languageName = (value?: string) =>
  languages.find(([code]) => code === value)?.[1] || value || "Not set";
const displayName = (customer: Obj) =>
  customer.display_name || customer.name || "Guest";
const customerLanguage = (customer: Obj) =>
  customer.preferred_language || customer.language || "es-MX";
const records = (value: unknown): Obj[] => (Array.isArray(value) ? value : []);
const valueText = (value: unknown): string => {
  if (value == null) return "Not set";
  if (Array.isArray(value)) return value.map(valueText).join(", ");
  if (typeof value === "object")
    return Object.entries(value as Obj)
      .map(([key, entry]) => `${label(key)}: ${valueText(entry)}`)
      .join(" · ");
  return String(value);
};
const dateText = (value?: string) =>
  value && !Number.isNaN(Date.parse(value))
    ? new Date(value).toLocaleString("en-US", {
        timeZone: "America/Mexico_City",
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const preferenceKey = (preference: Obj) =>
  preference.preference_key || preference.key || "preference";
const preferenceValue = (preference: Obj) =>
  preference.preference_value ?? preference.value;
const isExplicit = (preference: Obj) =>
  String(
    preference.preference_type || preference.type || preference.source || "",
  ).toLowerCase() === "explicit" || preference.explicitly_confirmed === true;
const billingLabel = (status: unknown, count?: number) =>
  typeof status === "string"
    ? status === "ON_FILE"
      ? "Billing profile saved"
      : status === "MISSING"
        ? "No saved billing profile"
        : label(status)
    : typeof (status as Obj)?.has_profile === "boolean"
      ? (status as Obj).has_profile
        ? "Billing profile saved"
        : "No saved billing profile"
      : typeof count === "number"
        ? count > 0
          ? "Billing profile saved"
          : "No saved billing profile"
        : "Billing status unavailable";

function Status({
  children,
  confirmed = false,
}: {
  children: React.ReactNode;
  confirmed?: boolean;
}) {
  return (
    <span className={`badge ${confirmed ? "green" : "neutral"}`}>
      <i />
      {children}
    </span>
  );
}

export default function Customers({ role }: { role: string }) {
  const [customers, setCustomers] = useState<Obj[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<Obj | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("es-MX");
  const [editing, setEditing] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const canManage = role === "OWNER" || role === "MANAGER";

  const loadList = useCallback(async (signal?: AbortSignal) => {
    const response = await api("/customers", "GET", undefined, signal);
    setCustomers(
      records(
        response.customers ??
          response.data?.customers ??
          response.data ??
          response,
      ),
    );
  }, []);
  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    setLoading(true);
    loadList(controller.signal)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [canManage, loadList]);

  const applyDetail = (response: Obj) => {
    const payload = response.data || response;
    const customer = payload.customer || payload;
    setDetail({ ...payload, customer });
    setName(displayName(customer) === "Guest" ? "" : displayName(customer));
    setLanguage(customerLanguage(customer));
  };
  useEffect(() => {
    if (!selectedId || !canManage) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailLoading(true);
    setError("");
    setMessage("");
    setEditing(null);
    setKey("");
    setValue("");
    setConfirmed(false);
    setRemoveId(null);
    api(
      `/customers/${encodeURIComponent(selectedId)}`,
      "GET",
      undefined,
      controller.signal,
    )
      .then(applyDetail)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [selectedId, canManage]);

  const mutate = async (
    path: string,
    method: string,
    body: unknown,
    success: string,
  ) => {
    if (!selectedId || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api(path, method, body);
      // Mutations and reads are separate: never report an unverified local edit as saved data.
      setMessage(success);
      try {
        const response = await api(
          `/customers/${encodeURIComponent(selectedId)}`,
        );
        applyDetail(response);
        await loadList();
      } catch (e) {
        setError(
          `The change was saved, but refreshing the profile failed: ${(e as Error).message}`,
        );
      }
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!canManage) return null;
  const customer = detail?.customer || {};
  const preferenceData = detail?.preferences ?? customer.preferences;
  const preferences: Obj[] = Array.isArray(preferenceData)
    ? records(preferenceData)
    : [
        ...records(preferenceData?.explicit).map((entry) => ({
          ...entry,
          preference_type: "explicit",
        })),
        ...records(preferenceData?.inferred).map((entry) => ({
          ...entry,
          preference_type: "inferred",
        })),
      ];
  const orders = records(
    detail?.orders ??
      detail?.recent_orders ??
      detail?.order_history ??
      customer.recent_orders,
  );
  const events = records(
    detail?.events ?? detail?.memory_events ?? customer.memory_events,
  );
  const contacts = records(customer.contacts);
  const favorites = preferences.filter((preference) =>
    /favou?rite/.test(preferenceKey(preference)),
  );
  const preferenceLabel = (preference: Obj) => {
    const preferenceVal = preferenceValue(preference);
    if (/favou?rite.*item/.test(preferenceKey(preference))) {
      const item = orders
        .flatMap((order) => records(order.items))
        .find((item) => item.catalog_item_id === preferenceVal);
      if (item?.name) return item.name;
    }
    return valueText(preferenceVal);
  };
  const filtered = customers.filter((entry) =>
    [
      displayName(entry),
      entry.phone,
      ...records(entry.contacts).map(
        (contact) => contact.normalized_value || contact.value,
      ),
    ]
      .join(" ")
      .toLowerCase()
      .includes(query.toLowerCase()),
  );
  const root = selectedId ? `/customers/${encodeURIComponent(selectedId)}` : "";

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">EVERY CUSTOMER, REMEMBERED</div>
          <h1>{selectedId ? "Customer profile" : "Customers"}</h1>
          <p>Confirmed preferences, useful context and previous orders.</p>
        </div>
        <div className="page-head-action">
          {selectedId ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => {
                setSelectedId(null);
                setError("");
                setMessage("");
              }}
            >
              <ArrowLeft size={15} /> All customers
            </button>
          ) : (
            <button
              className="secondary"
              disabled={loading}
              onClick={async () => {
                setLoading(true);
                setError("");
                try {
                  await loadList();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setLoading(false);
                }
              }}
            >
              <RefreshCw size={15} /> Refresh
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {message && (
        <p role="status" aria-live="polite">
          {message}
        </p>
      )}
      {(selectedId ? detailLoading : loading) ? (
        <section className="panel">
          <div className="empty" role="status">
            <Loader2 className="spin" />
            <p>Loading customers…</p>
          </div>
        </section>
      ) : selectedId && detail ? (
        <div style={{ display: "grid", gap: 20 }}>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>{displayName(customer)}</h3>
                <p>Customer details</p>
              </div>
              <Users size={20} />
            </div>
            <div className="panel-body">
              <form
                className="form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  await mutate(
                    root,
                    "PATCH",
                    { display_name: name.trim(), preferred_language: language },
                    "Customer details saved.",
                  );
                }}
              >
                <div className="form-grid">
                  <label>
                    Display name
                    <input
                      value={name}
                      maxLength={120}
                      onChange={(event) => setName(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                  <label>
                    Preferred language
                    <select
                      value={language}
                      onChange={(event) => setLanguage(event.target.value)}
                      disabled={busy}
                    >
                      {!languages.some(([code]) => code === language) && (
                        <option value={language}>
                          {languageName(language)}
                        </option>
                      )}
                      {languages.map(([code, title]) => (
                        <option key={code} value={code}>
                          {title}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div>
                  <strong>Contacts</strong>
                  {contacts.length ? (
                    contacts.map((contact, index) => (
                      <p key={contact.id || index}>
                        {label(
                          contact.contact_type || contact.type || "Contact",
                        )}
                        : {contact.normalized_value || contact.value || "—"}{" "}
                        <Status confirmed={!!contact.verified_at}>
                          {contact.verified_at ? "Verified" : "Unverified"}
                        </Status>
                      </p>
                    ))
                  ) : (
                    <p className="muted">
                      {customer.phone || "No saved contacts."}
                      {customer.phone &&
                        " · Recognition only; verification required for protected access."}
                    </p>
                  )}
                </div>
                <div className="form-actions">
                  <button className="primary" disabled={busy} type="submit">
                    {busy ? "Saving…" : "Save details"}
                  </button>
                </div>
              </form>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Preferences & favorites</h3>
                <p>
                  Explicit preferences are confirmed. Inferred preferences are
                  suggestions.
                </p>
              </div>
            </div>
            <div className="panel-body">
              {favorites.length > 0 && (
                <p>
                  <strong>Favorites: </strong>
                  {favorites
                    .map(
                      (preference) =>
                        `${preferenceLabel(preference)}${isExplicit(preference) ? " (confirmed)" : " (inferred)"}`,
                    )
                    .join(" · ")}
                </p>
              )}
              {preferences.length ? (
                <div style={{ display: "grid", gap: 16, marginBottom: 24 }}>
                  {preferences.map((preference, index) => (
                    <div
                      key={preference.id || index}
                      style={{
                        borderBottom: "1px solid var(--line)",
                        paddingBottom: 14,
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 12,
                          flexWrap: "wrap",
                        }}
                      >
                        <div>
                          <strong>{label(preferenceKey(preference))}</strong>{" "}
                          <Status confirmed={isExplicit(preference)}>
                            {isExplicit(preference)
                              ? "Explicit · confirmed"
                              : "Inferred · unconfirmed"}
                          </Status>
                          <p>{preferenceLabel(preference)}</p>
                          <small className="muted">
                            {preference.source
                              ? `Source: ${label(preference.source)} · `
                              : ""}
                            {dateText(
                              preference.updated_at || preference.created_at,
                            )}
                          </small>
                        </div>
                        <div
                          style={{
                            display: "flex",
                            alignItems: "start",
                            gap: 10,
                          }}
                        >
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => {
                              setEditing(
                                String(
                                  preference.id || preferenceKey(preference),
                                ),
                              );
                              setKey(preferenceKey(preference));
                              setValue(valueText(preferenceValue(preference)));
                              setConfirmed(false);
                              setRemoveId(null);
                            }}
                          >
                            Correct
                          </button>
                          {preference.id && (
                            <button
                              className="icon-button"
                              disabled={busy}
                              aria-label={`Remove ${label(preferenceKey(preference))}`}
                              onClick={() => setRemoveId(preference.id)}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                      {removeId === preference.id && (
                        <div className="info-banner">
                          <p>
                            Remove this saved preference? The change will appear
                            in memory history.
                          </p>
                          <button
                            className="secondary"
                            disabled={busy}
                            onClick={async () => {
                              if (
                                await mutate(
                                  `${root}/preferences/${encodeURIComponent(preference.id)}`,
                                  "DELETE",
                                  undefined,
                                  "Preference removed.",
                                )
                              )
                                setRemoveId(null);
                            }}
                          >
                            Remove preference
                          </button>{" "}
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() => setRemoveId(null)}
                          >
                            Keep preference
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  No saved preferences yet. Favorites appear here when saved as
                  a preference.
                </p>
              )}
              <form
                className="form"
                onSubmit={async (event) => {
                  event.preventDefault();
                  if (!confirmed) return;
                  if (
                    await mutate(
                      `${root}/preferences`,
                      "POST",
                      {
                        preference_key: key.trim(),
                        preference_value: value.trim(),
                        confirmed: true,
                        scope: "permanent",
                      },
                      "Confirmed preference saved.",
                    )
                  ) {
                    setEditing(null);
                    setKey("");
                    setValue("");
                    setConfirmed(false);
                  }
                }}
              >
                <h3>
                  {editing ? "Correct preference" : "Add confirmed preference"}
                </h3>
                <div className="form-grid">
                  <label>
                    Preference
                    <input
                      required
                      maxLength={64}
                      pattern="[a-z][a-z0-9_]*"
                      title="Use lowercase letters, numbers and underscores, starting with a letter."
                      placeholder="favorite_item"
                      value={key}
                      disabled={busy || !!editing}
                      onChange={(event) => setKey(event.target.value)}
                    />
                  </label>
                  <label>
                    Value
                    <input
                      required
                      maxLength={240}
                      placeholder="Customer’s preference"
                      value={value}
                      disabled={busy}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  </label>
                </div>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={busy}
                    onChange={(event) => setConfirmed(event.target.checked)}
                  />
                  Customer explicitly confirmed this as a lasting preference.
                </label>
                <div className="form-actions">
                  {editing && (
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setKey("");
                        setValue("");
                        setConfirmed(false);
                      }}
                    >
                      Cancel correction
                    </button>
                  )}
                  <button
                    className="primary"
                    disabled={
                      busy || !confirmed || !key.trim() || !value.trim()
                    }
                    type="submit"
                  >
                    <Plus size={14} />
                    {editing ? "Save correction" : "Save preference"}
                  </button>
                </div>
              </form>
            </div>
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Recent orders</h3>
                <p>Safe order summaries from this customer’s history.</p>
              </div>
            </div>
            {orders.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>ORDER</th>
                      <th>DATE</th>
                      <th>ITEMS</th>
                      <th>STATUS</th>
                      <th>TOTAL</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders.map((order, index) => (
                      <tr key={order.id || order.order_id || index}>
                        <td>
                          {order.external_reference ||
                            order.reference ||
                            order.order_id ||
                            order.id ||
                            "Order"}
                        </td>
                        <td>{dateText(order.created_at)}</td>
                        <td>
                          {order.summary ||
                            records(order.items)
                              .map(
                                (item) =>
                                  `${item.quantity || 1} × ${item.name || item.item_name || "Item"}`,
                              )
                              .join(", ") ||
                            `${order.item_count ?? "—"} items`}
                        </td>
                        <td>
                          <Status>{label(order.status || "unknown")}</Status>
                        </td>
                        <td>
                          {typeof order.total === "number"
                            ? money(order.total, order.currency)
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="panel-body">
                <p className="muted">No previous orders available.</p>
              </div>
            )}
          </section>
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Memory history</h3>
                <p>Changes to this customer’s saved context.</p>
              </div>
            </div>
            <div className="panel-body">
              {events.length ? (
                events.map((event, index) => (
                  <div
                    key={event.id || index}
                    style={{
                      padding: "10px 0",
                      borderBottom: "1px solid var(--line)",
                    }}
                  >
                    <strong>
                      {label(
                        event.event_type ||
                          event.type ||
                          event.action ||
                          "Memory updated",
                      )}
                    </strong>
                    <p className="muted">
                      {dateText(event.created_at)}
                      {event.source ? ` · ${label(event.source)}` : ""}
                      {event.preference_key
                        ? ` · ${label(event.preference_key)}`
                        : ""}
                    </p>
                    {event.detail && <p>{event.detail}</p>}
                  </div>
                ))
              ) : (
                <p className="muted">No memory changes recorded.</p>
              )}
            </div>
          </section>
          {role === "OWNER" && (
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h3>Billing status</h3>
                  <p>
                    Protected fiscal details are managed through authorized
                    billing tools.
                  </p>
                </div>
              </div>
              <div className="panel-body">
                <p>
                  {billingLabel(
                    detail.billing_status ?? customer.billing_status,
                    customer.billing_profile_count,
                  )}
                </p>
                {typeof customer.billing_profile_count === "number" && (
                  <p className="muted">
                    {customer.billing_profile_count} saved billing{" "}
                    {customer.billing_profile_count === 1
                      ? "profile"
                      : "profiles"}
                  </p>
                )}
              </div>
            </section>
          )}
        </div>
      ) : !selectedId ? (
        <>
          <div className="form" style={{ marginBottom: 18 }}>
            <label style={{ maxWidth: 400 }}>
              <span>
                <Search size={13} /> Search customers
              </span>
              <input
                type="search"
                value={query}
                placeholder="Name or contact"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          </div>
          <section className="panel">
            {filtered.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>CUSTOMER</th>
                      <th>CONTACT</th>
                      <th>LANGUAGE</th>
                      <th>ORDERS</th>
                      {role === "OWNER" && <th>BILLING</th>}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((entry) => (
                      <tr className="click-row" key={entry.id}>
                        <td>
                          <button
                            className="text-button"
                            onClick={() => setSelectedId(entry.id)}
                          >
                            {displayName(entry)}
                          </button>
                        </td>
                        <td>
                          {entry.phone ||
                            records(entry.contacts)
                              .map(
                                (contact) =>
                                  contact.normalized_value || contact.value,
                              )
                              .join(", ") ||
                            "—"}
                        </td>
                        <td>
                          {languageName(
                            entry.preferred_language || entry.language,
                          )}
                        </td>
                        <td>{entry.order_count ?? "—"}</td>
                        {role === "OWNER" && (
                          <td>
                            {billingLabel(
                              entry.billing_status,
                              entry.billing_profile_count,
                            )}
                          </td>
                        )}
                        <td>
                          <button
                            className="icon-button"
                            aria-label={`Open ${displayName(entry)}`}
                            onClick={() => setSelectedId(entry.id)}
                          >
                            <ChevronRight size={16} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty">
                <Users size={30} />
                <h3>{query ? "No matching customers" : "No customers yet"}</h3>
                <p>
                  {query
                    ? "Try a different name or contact."
                    : "Customer profiles appear here as customers are recognized and saved."}
                </p>
              </div>
            )}
          </section>
        </>
      ) : (
        <section className="panel">
          <div className="empty">
            <p>
              The customer profile could not be loaded. Return to the list and
              try again.
            </p>
          </div>
        </section>
      )}
    </>
  );
}
