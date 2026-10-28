"use client";
import React, { useState, useEffect, useCallback, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  AudioLines,
  LayoutDashboard,
  ShoppingBag,
  Phone,
  BrainCircuit,
  UtensilsCrossed,
  Plug,
  Zap,
  CreditCard,
  ChartNoAxesCombined,
  Users,
  Settings,
  ChevronDown,
  ChevronRight,
  Search,
  Bell,
  Plus,
  X,
  Check,
  CheckCheck,
  MoreHorizontal,
  RefreshCw,
  Download,
  Headphones,
  Clock,
  Play,
  Send,
  Mic,
  MicOff,
  ShieldCheck,
  ExternalLink,
  BookOpen,
  SlidersHorizontal,
  Menu as MenuIcon,
  LogOut,
  AlertTriangle,
  CheckCircle2,
  Globe,
  KeyRound,
  Trash2,
  Pencil,
  Power,
  Volume2,
  Loader2,
  Ellipsis,
  PhoneCall,
  Inbox,
  CalendarDays,
  Copy,
  MessageCircle,
  LifeBuoy,
  SquareArrowOutUpRight,
  Radio,
  FileText,
} from "lucide-react";
import { Obj, Workspace, money, label, time, api } from "./types";
import { Configuration, Onboarding } from "./Configuration";
import MenuImport from "./MenuImport";
import VoiceCall from "./VoiceCall";
import CustomerOrderLink from "./CustomerOrderLink";
import CustomerReceipt from "./CustomerReceipt";
import { confirmedOrders, inPeriod } from "./reporting";
import {
  consumeSupabaseMagicLink,
  requestSupabaseMagicLink,
  supabaseAuthConfigured,
  clearBrowserSignIn,
} from "./supabase-auth";
const nav = [
  {
    group: "WORKSPACE",
    items: [
      ["Overview", LayoutDashboard],
      ["Orders", ShoppingBag],
      ["Calls", Phone],
      ["Escalations", LifeBuoy],
      ["Language memory", BrainCircuit],
    ],
  },
  {
    group: "MANAGE",
    items: [
      ["Menu", UtensilsCrossed],
      ["Phone & agent", AudioLines],
      ["AI model", Zap],
      ["Integrations", Plug],
      ["Payments", CreditCard],
      ["Notifications", Bell],
      ["Analytics", ChartNoAxesCombined],
    ],
  },
] as const;
const allowedPages = (role: string) =>
  role === "STAFF"
    ? ["Orders", "Calls"]
    : role === "MANAGER"
      ? [
          "Overview",
          "Orders",
          "Calls",
          "Escalations",
          "Language memory",
          "Menu",
        ]
      : [
          "Overview",
          "Orders",
          "Calls",
          "Escalations",
          "Language memory",
          "Menu",
          "Phone & agent",
          "AI model",
          "Integrations",
          "Payments",
          "Notifications",
          "Analytics",
          "Team",
          "Settings",
          "Diagnostics",
        ];
const paid = (o: Obj) => o.payment_status === "PAID";
const badgeClass = (s: string) =>
  /PAID|COMPLETED|READY|APPROVED|ACTIVE|AVAILABLE|RESOLVED/i.test(s)
    ? "green"
    : /FAIL|CANCEL|ESCALAT|ERROR|SOLD_OUT/i.test(s)
      ? "red"
      : /PENDING|CLARIFICATION|NEW|DRAFT|PREPARING/i.test(s)
        ? "amber"
        : "neutral";
export function Badge({
  value,
  children,
}: {
  value?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className={"badge " + badgeClass(value || "")}>
      <i />
      {children || label(value)}
    </span>
  );
}
export function Empty({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Modal({
  title,
  subtitle,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", f);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", f);
      document.body.style.overflow = prev;
    };
  }, [onClose]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className={"modal " + (wide ? "wide" : "")}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <header>
          <div>
            <h2>{title}</h2>
            {subtitle && <p>{subtitle}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
function Logo() {
  return (
    <div className="brand">
      <span className="brand-symbol">
        <AudioLines size={24} />
      </span>
      <span>
        ring<span className="brand-light">orden</span>
        <span className="brand-dot">.</span>
      </span>
    </div>
  );
}
export default function MerchantApp() {
  const [data, setData] = useState<Workspace | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState("Overview"),
    [search, setSearch] = useState(""),
    [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<Obj | null>(null),
    [toast, setToast] = useState(""),
    [busy, setBusy] = useState(false),
    [sidebar, setSidebar] = useState(false),
    [notifications, setNotifications] = useState(false),
    [range, setRange] = useState("Today");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginSent, setLoginSent] = useState(false);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [mojoAuthReady, setMojoAuthReady] = useState(false);
  const [useEmailSignIn, setUseEmailSignIn] = useState(false);
  const notify = useCallback((s: string) => {
    setToast(s);
    setTimeout(() => setToast(""), 5000);
  }, []);
  const load = useCallback(async () => {
    try {
      setData(await api("/bootstrap"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/auth/config", { cache: "no-store", signal: controller.signal })
      .then(async (response) =>
        response.ok
          ? ((await response.json()) as { mojoauth?: { configured?: boolean } })
          : null,
      )
      .then((config) => {
        if (!controller.signal.aborted)
          setMojoAuthReady(config?.mojoauth?.configured === true);
      })
      .catch(() => {
        /* Existing Supabase or platform sign-in remains available. */
      });
    const url = new URL(window.location.href);
    const problem = url.searchParams.get("signin_error");
    if (problem) {
      setLoginError(
        problem === "cancelled"
          ? "Sign-in was cancelled. You can try again."
          : "We couldn’t complete sign-in. Please try again.",
      );
      url.searchParams.delete("signin_error");
      window.history.replaceState(
        null,
        "",
        url.pathname + url.search + url.hash,
      );
    }
    return () => controller.abort();
  }, []);
  useEffect(() => {
    const callbackError = consumeSupabaseMagicLink();
    if (callbackError) setLoginError(callbackError);
    else if (!window.location.hash) load();
  }, [load]);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        document
          .querySelector<HTMLInputElement>(
            'input[aria-label=\"Search orders\"]',
          )
          ?.focus();
      }
    };
    document.addEventListener("keydown", f);
    const invitation = new URLSearchParams(window.location.search).get(
      "invite",
    );
    if (invitation) setModal("invite");
    return () => document.removeEventListener("keydown", f);
  }, []);
  useEffect(() => {
    if (data && !allowedPages(data.user.role).includes(page)) setPage("Orders");
  }, [data?.user?.role, page]);
  const navigate = (p: string) => {
    setPage(p);
    setSearch("");
    setSidebar(false);
  };
  const action = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    try {
      const r = await api(path, method, body);
      await load();
      return r;
    } catch (e) {
      notify((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };
  const sendSignInLink = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await requestSupabaseMagicLink(loginEmail);
      setLoginSent(true);
    } catch (e) {
      setLoginError((e as Error).message);
    } finally {
      setLoginBusy(false);
    }
  };
  const signOut = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/auth/logout", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!response.ok)
        throw new Error("We couldn’t sign you out. Please try again.");
      clearBrowserSignIn();
      window.location.assign("/");
    } catch (error) {
      notify((error as Error).message);
      setBusy(false);
    }
  };
  const exportOrders = () => {
    if (!data) return;
    const rows = [
      [
        "Order",
        "Customer",
        "Status",
        "Payment",
        "Total",
        "Currency",
        "Created",
      ],
      ...data.orders.map((o) => [
        o.external_reference || o.id,
        o.customer?.name || "Guest",
        o.status,
        o.payment_status,
        o.total,
        o.currency,
        o.created_at,
      ]),
    ];
    const csv = rows
      .map((r) =>
        r
          .map((v) => '"' + String(v ?? "").replaceAll('"', '""') + '"')
          .join(","),
      )
      .join("\n");
    const u = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = u;
    a.download = "ring-orden-orders.csv";
    a.click();
    URL.revokeObjectURL(u);
    notify("Orders exported.");
  };
  if (!data)
    return (
      <div className="loading-page">
        <Logo />
        {error && mojoAuthReady && !useEmailSignIn ? (
          <>
            <h2>Welcome to Ring Orden</h2>
            <p>Sign in securely to open your restaurant workspace.</p>
            {loginError && (
              <p role="alert" style={{ color: "#923c4e" }}>
                {loginError}
              </p>
            )}
            <a className="primary" href="/api/auth/mojo/login">
              Sign in with MojoAuth <ArrowRight size={16} />
            </a>
            {supabaseAuthConfigured && (
              <button
                className="text-button"
                onClick={() => {
                  setUseEmailSignIn(true);
                  setLoginError("");
                }}
              >
                Use existing email sign-in
              </button>
            )}
          </>
        ) : error.toLowerCase().includes("sign in") &&
          supabaseAuthConfigured ? (
          <>
            <h2>Sign in to Ring Orden</h2>
            {mojoAuthReady && (
              <button
                className="text-button"
                onClick={() => setUseEmailSignIn(false)}
              >
                Use MojoAuth instead
              </button>
            )}
            <p>
              {loginSent
                ? `Check ${loginEmail} for your secure sign-in link.`
                : "Enter your email and we’ll send you a secure sign-in link."}
            </p>
            {!loginSent && (
              <form
                onSubmit={sendSignInLink}
                style={{
                  display: "grid",
                  gap: 12,
                  width: "min(360px, calc(100vw - 48px))",
                }}
              >
                <input
                  aria-label="Email address"
                  autoComplete="email"
                  type="email"
                  required
                  value={loginEmail}
                  onChange={(event) => setLoginEmail(event.target.value)}
                  placeholder="you@example.com"
                  style={{
                    border: "1px solid #d9d4cb",
                    borderRadius: 10,
                    padding: "13px 15px",
                    font: "inherit",
                  }}
                />
                <button className="primary" type="submit" disabled={loginBusy}>
                  {loginBusy ? "Sending link…" : "Email me a sign-in link"}
                </button>
              </form>
            )}
            {loginError && (
              <p role="alert" style={{ color: "#923c4e" }}>
                {loginError}
              </p>
            )}
            {loginSent && (
              <button
                className="primary"
                onClick={() => {
                  setLoginSent(false);
                  setLoginError("");
                }}
              >
                Use a different email
              </button>
            )}
          </>
        ) : (
          <>
            <Loader2 className="spin" />
            <h2>
              {error
                ? "Your workspace needs a moment"
                : "Getting your counter ready…"}
            </h2>
            <p>{error || "Loading your orders, menu, and conversations."}</p>
          </>
        )}
        {error && !error.toLowerCase().includes("sign in") && (
          <button className="primary" onClick={load}>
            Try again
          </button>
        )}
      </div>
    );
  const orders = data.orders || [],
    mem = data.memories || [],
    calls = data.calls || [];
  const matches = orders.filter((o) =>
    JSON.stringify([o.external_reference, o.customer, o.items])
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const currentOrder = selected
    ? orders.find((o) => o.id === selected.id) || selected
    : null;
  return (
    <div className="app-shell">
      <aside className={"sidebar " + (sidebar ? "open" : "")}>
        <Logo />
        <button className="workspace" onClick={() => setModal("workspace")}>
          <span className="merchant-avatar">
            {(data.merchant.name || "Ring Orden")
              .split(" ")
              .slice(0, 2)
              .map((w: string) => w[0])
              .join("")}
          </span>
          <span>
            <strong>{data.merchant.name || "Cafecito Roma"}</strong>
            <small>Restaurant workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <nav>
          {nav.map((g) => (
            <div className="nav-group" key={g.group}>
              <div className="nav-label">
                {g.items.some(([name]) =>
                  allowedPages(data.user.role).includes(name),
                )
                  ? g.group
                  : ""}
              </div>
              {g.items
                .filter(([name]) => allowedPages(data.user.role).includes(name))
                .map(([name, Icon]) => (
                  <button
                    className={"nav-item " + (page === name ? "active" : "")}
                    key={name}
                    onClick={() => navigate(name)}
                  >
                    <Icon size={18} />
                    <span>{name}</span>
                    {name === "Orders" && (
                      <b>
                        {
                          orders.filter(
                            (o) =>
                              !["COMPLETED", "CANCELLED", "REFUNDED"].includes(
                                o.status,
                              ),
                          ).length
                        }
                      </b>
                    )}
                    {name === "Language memory" && (
                      <span className="tiny-new">NEW</span>
                    )}
                    {name === "Escalations" &&
                      data.escalations.filter((e) => e.status !== "RESOLVED")
                        .length > 0 && <i className="nav-dot" />}
                  </button>
                ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {data.user.provider === "mojoauth" && (
            <button className="nav-item" disabled={busy} onClick={signOut}>
              Sign out of workspace
            </button>
          )}
          {data.user.role !== "STAFF" && (
            <div className="help-card">
              <span className="help-icon">
                <Headphones size={18} />
              </span>
              <strong>Your next order is calling.</strong>
              <p>Meet your new favorite teammate.</p>
              <button onClick={() => setModal("simulator")}>
                Try the agent <ArrowUpRight size={14} />
              </button>
            </div>
          )}
          {data.user.role === "OWNER" && (
            <>
              <button className="nav-item" onClick={() => navigate("Team")}>
                <Users size={18} />
                Team
              </button>
              <button
                className={"nav-item " + (page === "Settings" ? "active" : "")}
                onClick={() => navigate("Settings")}
              >
                <Settings size={18} />
                Settings
              </button>
              <button
                className="system-status"
                onClick={() => navigate("Diagnostics")}
              >
                <span className="status-light" />
                {data.mode === "demo"
                  ? "Demo workspace"
                  : "Workspace connected"}
                <ArrowUpRight size={12} />
              </button>
            </>
          )}
        </div>
      </aside>
      {sidebar && (
        <div className="mobile-overlay" onClick={() => setSidebar(false)} />
      )}
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setSidebar(!sidebar)}
              aria-label="Open navigation"
            >
              <MenuIcon size={21} />
            </button>
            <span className="crumb-workspace">Workspace</span>
            <ChevronRight size={13} />
            <strong>{page}</strong>
          </div>
          <div className="top-actions">
            <div className="search-box">
              <Search size={16} />
              <input
                aria-label="Search orders"
                placeholder="Search anything…"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                }}
              />
              <kbd>⌘ K</kbd>
            </div>
            <span className="demo-pill">
              {data.mode === "demo" ? "Demo mode" : "Live workspace"}
            </span>
            <div className="bell-wrap">
              <button
                className="icon-button"
                aria-label="View notifications"
                onClick={() => setNotifications(!notifications)}
              >
                <Bell size={18} />
                <span className="bell-dot" />
              </button>
              {notifications && (
                <div className="notification-pop">
                  <strong>Notifications</strong>
                  {data.escalations.filter((e) => e.status !== "RESOLVED")
                    .length > 0 ? (
                    <p>A conversation needs your attention.</p>
                  ) : (
                    <p>You’re all caught up.</p>
                  )}
                  <button
                    className="text-button"
                    onClick={() => {
                      navigate("Notifications");
                      setNotifications(false);
                    }}
                  >
                    Notification settings <ArrowRight size={14} />
                  </button>
                </div>
              )}
            </div>
            <button
              className="avatar"
              title="Workspace settings"
              onClick={() => {
                if (data.user.role === "OWNER") navigate("Settings");
              }}
            >
              {(data.user?.name || "Shirley").slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="error-banner">
              <AlertTriangle size={16} />
              {error}
              <button onClick={load}>Reconnect</button>
            </div>
          )}
          {search ? (
            <>
              <PageHead
                eyebrow="YOUR WORKSPACE"
                title="Find an order"
                description={`${matches.length} orders match “${search}”`}
              />
              <OrdersTable orders={matches} onSelect={setSelected} />
            </>
          ) : (
            <>
              {page === "Overview" && (
                <Overview
                  data={data}
                  onSelect={setSelected}
                  navigate={navigate}
                  onTest={() => setModal("simulator")}
                  range={range}
                  setRange={setRange}
                />
              )}
              {page === "Orders" && (
                <OrdersPage
                  canCreate={data.user.role !== "STAFF"}
                  orders={orders}
                  onSelect={setSelected}
                  onNew={() => setModal("neworder")}
                  onExport={exportOrders}
                />
              )}
              {page === "Calls" && (
                <>
                  <PageHead
                    eyebrow="EVERY CONVERSATION COUNTS"
                    title="Calls"
                    description="From the first hello to the final confirmation."
                    action={
                      <button
                        className="primary"
                        onClick={() => setModal("simulator")}
                      >
                        <PhoneCall size={16} />
                        Test your agent
                      </button>
                    }
                  />
                  <div className="metrics three">
                    <Metric
                      title="Conversations"
                      value={String(calls.length)}
                      icon={Phone}
                    />
                    <Metric
                      title="Orders from calls"
                      value={String(
                        orders.filter((o) => o.source === "voice").length,
                      )}
                      icon={ShoppingBag}
                    />
                    <Metric
                      title="Needs a person"
                      value={String(
                        data.escalations.filter((e) => e.status !== "RESOLVED")
                          .length,
                      )}
                      icon={Headphones}
                    />
                  </div>
                  <section className="panel">
                    <div className="panel-header">
                      <h3>Call history</h3>
                      <span className="muted">
                        {data.mode === "demo"
                          ? "Sample conversations"
                          : "All conversations"}
                      </span>
                    </div>
                    <div className="table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>CALLER</th>
                            <th>STARTED</th>
                            <th>DURATION</th>
                            <th>LANGUAGE</th>
                            <th>OUTCOME</th>
                            <th />
                          </tr>
                        </thead>
                        <tbody>
                          {calls.map((c, i) => (
                            <tr
                              className="click-row"
                              key={c.id || i}
                              onClick={() => {
                                setSelected(
                                  orders.find((o) => o.id === c.order_id) ||
                                    null,
                                );
                                if (!orders.find((o) => o.id === c.order_id))
                                  setModal("simulator");
                              }}
                            >
                              <td>
                                <div className="cell-person">
                                  <span className="small-avatar">
                                    <Phone size={14} />
                                  </span>
                                  <div>
                                    <strong>
                                      {c.customer_name ||
                                        c.name ||
                                        c.customer ||
                                        "Guest caller"}
                                    </strong>
                                    <small>{c.phone || "Phone withheld"}</small>
                                  </div>
                                </div>
                              </td>
                              <td>{time(c.started_at || c.created_at)}</td>
                              <td>
                                {c.duration_seconds || c.duration
                                  ? `${Math.floor((c.duration_seconds || c.duration) / 60)}m ${(c.duration_seconds || c.duration) % 60}s`
                                  : "In progress"}
                              </td>
                              <td>{c.language || "English"}</td>
                              <td>
                                <Badge
                                  value={
                                    c.status === "ACTIVE"
                                      ? "IN_PROGRESS"
                                      : c.status || "COMPLETED"
                                  }
                                />
                              </td>
                              <td>
                                <ChevronRight size={16} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {!calls.length && (
                      <Empty
                        title="Your first hello is ahead"
                        description="Start a test conversation to see it here."
                      />
                    )}
                  </section>
                </>
              )}
              {page === "Language memory" && (
                <MemoryPage
                  memories={mem}
                  catalog={data.catalog}
                  onAction={async (id, act, extra) => {
                    const r = await action(
                      "/memories/" + id,
                      act === "delete" ? "DELETE" : "PATCH",
                      { action: act, ...extra },
                    );
                    if (r)
                      notify(
                        act === "delete"
                          ? "Memory deleted."
                          : "Memory updated.",
                      );
                    return !!r;
                  }}
                />
              )}
              {page === "Menu" && (
                <MenuPage
                  canEdit={data.user.role === "OWNER"}
                  catalog={data.catalog}
                  onEdit={(i) => {
                    setSelected(i);
                    setModal("menu");
                  }}
                  onToggle={async (i) => {
                    await action("/menu/" + i.id, "PATCH", {
                      available: !i.available,
                    });
                  }}
                  onAdd={() => {
                    setSelected(null);
                    setModal("menu");
                  }}
                  onImport={() => setModal("import")}
                />
              )}
              {page === "Escalations" && (
                <>
                  <PageHead
                    eyebrow="THE HUMAN TOUCH"
                    title="A little help, when it matters"
                    description="Conversations your team can take from here."
                  />
                  <section className="panel">
                    {!data.escalations.length ? (
                      <Empty
                        title="All conversations are in good hands"
                        description="Requests for a person and tricky orders will appear here."
                      />
                    ) : (
                      data.escalations.map((e) => (
                        <div className="escalation-row" key={e.id}>
                          <div className="escalation-icon">
                            <Headphones size={20} />
                          </div>
                          <div>
                            <h3>
                              {e.reason || "Customer requested assistance"}
                            </h3>
                            <p>
                              {e.customer_name || e.customer || "Guest"} ·{" "}
                              {time(e.created_at)}
                            </p>
                            <small>
                              {e.context ||
                                e.notes ||
                                "Review the conversation before calling back."}
                            </small>
                          </div>
                          <Badge value={e.status || "OPEN"} />
                          {e.status !== "RESOLVED" && (
                            <button
                              className="secondary"
                              disabled={busy}
                              onClick={async () => {
                                const r = await action(
                                  "/escalations/" + e.id + "/resolve",
                                  "POST",
                                  {},
                                );
                                if (r) notify("Marked as resolved.");
                              }}
                            >
                              <Check size={15} />
                              Resolve
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </section>
                </>
              )}
              {page === "Analytics" && <Analytics data={data} />}
              {[
                "Phone & agent",
                "AI model",
                "Integrations",
                "Payments",
                "Notifications",
                "Team",
                "Settings",
                "Diagnostics",
              ].includes(page) && (
                <Configuration
                  page={page}
                  data={data}
                  action={action}
                  notify={notify}
                  onTest={() => setModal("simulator")}
                  onOnboard={() => setModal("onboarding")}
                  onVoice={() => setModal("voice")}
                />
              )}
            </>
          )}
          <footer className="page-footer">
            <span>
              <span className="footer-ring">◉</span> A little more human. A lot
              more ordered.
            </span>
            <span>
              Ring Orden <span>© 2026</span>
            </span>
          </footer>
        </main>
      </div>
      {selected && modal === null && currentOrder && (
        <OrderDetail
          order={currentOrder}
          data={data}
          onClose={() => setSelected(null)}
          busy={busy}
          onCustomerLink={(method) =>
            action("/orders/" + currentOrder.id + "/customer-link", method, {})
          }
          onReceipt={(route, method, body) =>
            action(`/orders/${currentOrder.id}/${route}`, method, body)
          }
          onAction={async (a) => {
            const r = await action(
              "/orders/" + currentOrder.id + "/action",
              "POST",
              { action: a, ...(a === "confirm" ? { confirmed: true } : {}) },
            );
            if (r) {
              if (r.checkout_url) {
                setModal("paymentlink");
                setSelected({ ...currentOrder, checkout_url: r.checkout_url });
              }
              notify(
                a === "demo_pay"
                  ? "Demo payment recorded. No money was charged."
                  : "Order updated.",
              );
            }
          }}
        />
      )}
      {modal === "paymentlink" && (
        <Modal
          title="Your payment link is ready"
          subtitle="Share it with your guest, or open Stripe Checkout."
          onClose={() => {
            setModal(null);
            setSelected(null);
          }}
        >
          <div className="modal-body form">
            <a
              className="primary"
              href={selected?.checkout_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open payment link <ExternalLink size={16} />
            </a>
          </div>
        </Modal>
      )}
      {modal === "invite" && (
        <Modal
          title="Join your team’s counter"
          subtitle="Sign in with the email address that received this invitation."
          onClose={() => setModal(null)}
        >
          <div className="modal-body form">
            <p>
              You’re signed in as {data.user.email || data.user.name}. Accepting
              joins the workspace with the role selected by its owner.
            </p>
            <button
              className="primary"
              disabled={busy}
              onClick={async () => {
                const token = new URLSearchParams(window.location.search).get(
                  "invite",
                );
                const r = await action("/team/accept", "POST", { token });
                if (r) {
                  window.history.replaceState({}, "", window.location.pathname);
                  setModal(null);
                  notify("Welcome to the team.");
                  await load();
                }
              }}
            >
              <Users size={16} />
              Accept invitation
            </button>
          </div>
        </Modal>
      )}
      {modal === "voice" && (
        <VoiceCall
          onClose={() => setModal(null)}
          notify={notify}
          onUpdate={load}
        />
      )}
      {modal === "import" && (
        <MenuImport
          onClose={() => setModal(null)}
          onImport={async (items) => {
            const existing = new Set(
              data.catalog.map((i) => i.name.toLowerCase().trim()),
            );
            const duplicate = items.find((i) =>
              existing.has(i.name.toLowerCase().trim()),
            );
            if (duplicate)
              throw new Error(
                "Your menu already has " +
                  duplicate.name +
                  ". Remove duplicate rows before importing.",
              );
            let count = 0;
            for (const item of items) {
              try {
                await api("/menu", "POST", item);
                count++;
              } catch (e) {
                await load();
                throw new Error(
                  count +
                    " of " +
                    items.length +
                    " items were added. Check your menu and remove those rows before retrying. " +
                    (e as Error).message,
                );
              }
            }
            await load();
            notify(count + " menu items imported.");
          }}
        />
      )}
      {modal === "simulator" && (
        <Simulator
          data={data}
          onClose={() => setModal(null)}
          onUpdate={load}
          notify={notify}
        />
      )}
      {modal === "neworder" && (
        <NewOrder
          catalog={data.catalog}
          action={action}
          onClose={() => setModal(null)}
          onDone={(o) => {
            setModal(null);
            setSelected(o);
            notify("Order created.");
          }}
        />
      )}
      {modal === "menu" && (
        <MenuEditor
          item={selected}
          action={action}
          onClose={() => {
            setModal(null);
            setSelected(null);
          }}
          onDone={() => {
            setModal(null);
            setSelected(null);
            notify("Menu saved.");
          }}
        />
      )}
      {modal === "workspace" && (
        <Modal
          title="Your workspace"
          subtitle="One counter. Everything in order."
          onClose={() => setModal(null)}
        >
          <div className="modal-body">
            <div className="workspace-option">
              <span className="merchant-avatar">
                {(data.merchant.name || "Ring Orden")
                  .split(" ")
                  .slice(0, 2)
                  .map((w: string) => w[0])
                  .join("")}
              </span>
              <div>
                <strong>{data.merchant.name}</strong>
                <p>
                  Mexico City ·{" "}
                  {data.mode === "demo"
                    ? "Demo workspace"
                    : "Merchant workspace"}
                </p>
              </div>
              <Check size={19} />
            </div>
            <button
              className="secondary full"
              onClick={() => setModal("onboarding")}
            >
              <SlidersHorizontal size={16} />
              Set up your business
            </button>
          </div>
        </Modal>
      )}
      {modal === "onboarding" && (
        <Onboarding
          data={data}
          action={action}
          notify={notify}
          onClose={() => setModal(null)}
          onTest={() => setModal("simulator")}
        />
      )}
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button onClick={() => setToast("")} aria-label="Dismiss">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
export function PageHead({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-head">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="page-head-action">{action}</div>}
    </div>
  );
}
function Metric({
  title,
  value,
  icon: Icon,
  detail,
}: {
  title: string;
  value: string;
  icon: React.ElementType;
  detail?: string;
}) {
  return (
    <article className="metric">
      <div className="metric-top">
        <span>{title}</span>
        <Icon size={17} />
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-detail">{detail || "In your selected period"}</div>
    </article>
  );
}
function Overview({
  data,
  onSelect,
  navigate,
  onTest,
  range,
  setRange,
}: {
  data: Workspace;
  onSelect: (o: Obj) => void;
  navigate: (p: string) => void;
  onTest: () => void;
  range: string;
  setRange: (s: string) => void;
}) {
  const o = data.orders;
  const timezone = data.merchant.timezone || "America/Mexico_City";
  const filtered = inPeriod(
    o as (Obj & { created_at: string })[],
    range,
    timezone,
  );
  const periodCalls = inPeriod(
    data.calls as (Obj & { created_at: string })[],
    range,
    timezone,
  );
  const revenue = filtered.filter(paid).reduce((a, x) => a + x.total, 0);
  const confirmed = confirmedOrders(filtered);
  const avg = confirmed.length
    ? confirmed.reduce((a, x) => a + x.total, 0) / confirmed.length
    : 0;
  return (
    <>
      <div className="overview-heading">
        <div>
          <div className="eyebrow">
            <span className="status-light" /> YOUR COUNTER, CONNECTED
          </div>
          <h1>
            A good day starts
            <br className="mobile-break" /> with a <em>ring.</em>
          </h1>
          <p>Here’s what’s happening at {data.merchant.name}.</p>
        </div>
        <div className="overview-tools">
          <select
            aria-label="Reporting period"
            className="date-select"
            value={range}
            onChange={(e) => setRange(e.target.value)}
          >
            <option>Today</option>
            <option>Last 7 days</option>
            <option>Last 30 days</option>
          </select>
          <button className="primary" onClick={onTest}>
            <PhoneCall size={16} />
            Test your agent
            <ArrowUpRight size={15} />
          </button>
        </div>
      </div>
      <div className="metrics">
        <Metric
          title="Total revenue"
          value={money(revenue)}
          icon={CreditCard}
          detail={`${filtered.filter(paid).length} paid orders · MXN`}
        />
        <Metric
          title="Orders received"
          value={String(filtered.length)}
          icon={ShoppingBag}
          detail={`${confirmed.length} confirmed orders`}
        />
        <Metric
          title="Calls answered"
          value={String(periodCalls.length)}
          icon={Phone}
          detail={
            data.mode === "demo"
              ? "Sample + test conversations"
              : "Conversations in your workspace"
          }
        />
        <Metric
          title="Average order"
          value={money(avg)}
          icon={ChartNoAxesCombined}
          detail="Across confirmed orders · MXN"
        />
      </div>
      <div className="overview-grid">
        <section className="panel revenue-panel">
          <div className="panel-header">
            <div>
              <h3>Your day, in orders</h3>
              <p>A little momentum, one conversation at a time.</p>
            </div>
            <div className="chart-legend">
              <i />
              Orders
            </div>
          </div>
          <OrderChart orders={filtered} timezone={timezone} />
          <div className="chart-foot">
            <span>
              <span className="status-light" /> Updates every few seconds
            </span>
            <button
              className="text-button"
              onClick={() => navigate("Analytics")}
            >
              View analytics <ArrowUpRight size={14} />
            </button>
          </div>
        </section>
        <section className="agent-card">
          <div className="agent-card-top">
            <span className="light-pill">
              <i />
              {data.mode === "demo" ? "MEET YOUR AGENT" : "YOUR VOICE AGENT"}
            </span>
            <AudioLines size={19} />
          </div>
          <div className="ring-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="orbit orbit-three" />
            <div className="orbit-center">
              <AudioLines size={38} strokeWidth={1.6} />
            </div>
            <span className="orbit-spark s1">✦</span>
            <span className="orbit-spark s2">✦</span>
            <span className="orbit-small" />
          </div>
          <div className="agent-card-copy">
            <h2>
              A warm hello.
              <br />
              An order, done right.
            </h2>
            <p>
              Your menu. Your voice.
              <br />A conversation that just flows.
            </p>
            <button onClick={onTest}>
              Give it a ring <ArrowUpRight size={16} />
            </button>
          </div>
        </section>
      </div>
      <div className="section-row">
        <div>
          <h2>Fresh off the line</h2>
          <span>The latest orders, all in one place.</span>
        </div>
        <button
          className="secondary compact"
          onClick={() => navigate("Orders")}
        >
          View all orders <ArrowRight size={14} />
        </button>
      </div>
      <OrdersTable orders={o.slice(0, 5)} onSelect={onSelect} />
      <div className="bottom-grid">
        <section className="panel memory-preview">
          <div className="preview-icon">
            <BrainCircuit size={22} />
          </div>
          <div>
            <span className="eyebrow">A LITTLE SMARTER, EVERY CALL</span>
            <h3>It gets your regulars.</h3>
            <p>
              Local phrases and little corrections become better conversations.
            </p>
            {data.memories[0] && (
              <div className="memory-example">
                “{data.memories[0].observed_text}” <ArrowRight size={14} />
                <strong>{memoryMeaning(data.memories[0])}</strong>
              </div>
            )}
          </div>
          <button
            className="icon-button"
            onClick={() => navigate("Language memory")}
            aria-label="Explore language memory"
          >
            <ArrowUpRight size={19} />
          </button>
        </section>
        <section className="panel setup-preview">
          <span className="preview-icon warm">
            <Plug size={21} />
          </span>
          <div>
            <h3>Make yourself at home.</h3>
            <p>Connect your phone, payments, and the tools you already use.</p>
            <button
              className="text-button"
              onClick={() => navigate("Integrations")}
            >
              Finish setting up <ArrowRight size={14} />
            </button>
          </div>
        </section>
      </div>
    </>
  );
}
function OrderChart({
  orders,
  timezone = "America/Mexico_City",
}: {
  orders: Obj[];
  timezone?: string;
}) {
  const bins = Array(9).fill(0);
  orders.forEach((o) => {
    const h = Number(
      new Date(o.created_at).toLocaleTimeString("en-GB", {
        hour: "2-digit",
        hour12: false,
        timeZone: timezone,
      }),
    );
    bins[Math.max(0, Math.min(8, Math.floor((h - 6) / 2)))]++;
  });
  const max = Math.max(4, ...bins);
  const coords = bins.map((v, i) => `${i * 80 + 34},${178 - (v / max) * 140}`);
  const line = "M" + coords.join(" L");
  const area = line + " L674,178 L34,178 Z";
  return (
    <div className="chart">
      <div className="chart-y">
        <span>{max}</span>
        <span>{Math.round(max * 0.75)}</span>
        <span>{Math.round(max * 0.5)}</span>
        <span>{Math.round(max * 0.25)}</span>
        <span>0</span>
      </div>
      <svg
        viewBox="0 0 710 205"
        role="img"
        aria-label="Orders received by hour"
      >
        <defs>
          <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#9e5460" stopOpacity=".22" />
            <stop offset="100%" stopColor="#9e5460" stopOpacity=".015" />
          </linearGradient>
        </defs>
        {[38, 73, 108, 143, 178].map((y) => (
          <line
            key={y}
            x1="34"
            x2="674"
            y1={y}
            y2={y}
            stroke="#eeeae6"
            strokeDasharray="3 4"
          />
        ))}
        <path d={area} fill="url(#chartFill)" />
        <path
          d={line}
          fill="none"
          stroke="#884453"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {bins.map((v, i) => (
          <circle
            key={i}
            cx={i * 80 + 34}
            cy={178 - (v / max) * 140}
            r="3.2"
            fill="#fff"
            stroke="#884453"
            strokeWidth="2"
          >
            <title>
              {6 + i * 2}:00 · {v} orders
            </title>
          </circle>
        ))}
      </svg>
      <div className="chart-x">
        {[
          "6 am",
          "8 am",
          "10 am",
          "12 pm",
          "2 pm",
          "4 pm",
          "6 pm",
          "8 pm",
          "10 pm",
        ].map((x) => (
          <span key={x}>{x}</span>
        ))}
      </div>
    </div>
  );
}
export function OrdersTable({
  orders,
  onSelect,
}: {
  orders: Obj[];
  onSelect: (o: Obj) => void;
}) {
  return (
    <section className="panel order-table">
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>ORDER</th>
              <th>CUSTOMER</th>
              <th>ITEMS</th>
              <th>STATUS</th>
              <th>PAYMENT</th>
              <th>TOTAL</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {orders.map((o) => (
              <tr
                key={o.id}
                className="click-row"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSelect(o);
                }}
                onClick={() => onSelect(o)}
              >
                <td>
                  <strong className="order-reference">
                    {o.external_reference || "#" + o.id.slice(-5)}
                  </strong>
                  <small className="cell-sub">{time(o.created_at)}</small>
                </td>
                <td>
                  <div className="cell-person">
                    <span
                      className={
                        "small-avatar tone-" +
                        ((o.customer?.name || "G").charCodeAt(0) % 4)
                      }
                    >
                      {(o.customer?.name || "G").slice(0, 1)}
                    </span>
                    <div>
                      <strong>{o.customer?.name || "Guest"}</strong>
                      <small>
                        {o.source === "voice"
                          ? "Phone order"
                          : label(o.source || "dashboard")}
                      </small>
                    </div>
                  </div>
                </td>
                <td className="items-cell">
                  <span>
                    {o.items
                      ?.slice(0, 2)
                      .map((i: Obj) => i.name)
                      .join(", ") || "New conversation"}
                  </span>
                  <small>
                    {o.items?.reduce(
                      (a: number, i: Obj) => a + i.quantity,
                      0,
                    ) || 0}{" "}
                    items · {label(o.fulfillment?.type || "pickup")}
                  </small>
                </td>
                <td>
                  <Badge value={o.status} />
                </td>
                <td>
                  <span
                    className={"payment-text " + (paid(o) ? "is-paid" : "")}
                  >
                    <span />
                    {label(o.payment_status || "PENDING")}
                  </span>
                </td>
                <td className="amount">{money(o.total)}</td>
                <td>
                  <ChevronRight size={16} color="#aaa59e" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!orders.length && (
        <Empty
          title="A fresh start"
          description="Your orders will appear here as they come in."
        />
      )}
    </section>
  );
}
function OrdersPage({
  orders,
  onSelect,
  onNew,
  onExport,
  canCreate = true,
}: {
  canCreate?: boolean;
  orders: Obj[];
  onSelect: (o: Obj) => void;
  onNew: () => void;
  onExport: () => void;
}) {
  const [tab, setTab] = useState("All orders"),
    [filter, setFilter] = useState("");
  const tabs = ["All orders", "Active", "Completed", "Cancelled"];
  const filtered = orders.filter(
    (o) =>
      (tab === "All orders" ||
        (tab === "Active" &&
          !["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status)) ||
        (tab === "Completed" && o.status === "COMPLETED") ||
        (tab === "Cancelled" && o.status === "CANCELLED")) &&
      JSON.stringify(o).toLowerCase().includes(filter.toLowerCase()),
  );
  return (
    <>
      <PageHead
        eyebrow="FROM HELLO TO PICKUP"
        title="Every order, in order."
        description="Your entire counter, without the chaos."
        action={
          <>
            <button className="secondary" onClick={onExport}>
              <Download size={16} />
              Export
            </button>
            {canCreate && (
              <button className="primary" onClick={onNew}>
                <Plus size={17} />
                New order
              </button>
            )}
          </>
        }
      />
      <div className="list-toolbar">
        <div className="tabs">
          {tabs.map((t) => (
            <button
              key={t}
              className={tab === t ? "selected" : ""}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "All orders" && <span>{orders.length}</span>}
            </button>
          ))}
        </div>
        <div className="inline-search">
          <Search size={16} />
          <input
            placeholder="Find an order…"
            aria-label="Filter orders"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
        </div>
      </div>
      <OrdersTable orders={filtered} onSelect={onSelect} />
    </>
  );
}
function memoryMeaning(m: Obj) {
  const c = m.corrected_interpretation || {};
  return (
    m.resolved_meaning ||
    c.description ||
    [c.product, c.modifier].filter(Boolean).map(label).join(" + ") ||
    JSON.stringify(c)
  );
}
function MemoryPage({
  memories,
  catalog,
  onAction,
}: {
  memories: Obj[];
  catalog: Obj[];
  onAction: (id: string, a: string, extra?: Obj) => Promise<boolean>;
}) {
  const [filter, setFilter] = useState("All memories"),
    [query, setQuery] = useState(""),
    [edit, setEdit] = useState<Obj | null>(null),
    [editError, setEditError] = useState("");
  const list = memories.filter(
    (m) =>
      (filter === "All memories" ||
        (filter === "Approved" && m.merchant_approved) ||
        (filter === "Needs review" && !m.merchant_approved && m.active) ||
        (filter === "Disabled" && !m.active)) &&
      JSON.stringify(m).toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <>
      <PageHead
        eyebrow="YOUR RESTAURANT’S OWN LITTLE DICTIONARY"
        title="Familiar words. Better orders."
        description="Your agent learns from confirmed corrections. You stay in control."
      />
      <div className="memory-info">
        <BrainCircuit size={23} />
        <div>
          <strong>Smarter conversations, without retraining.</strong>
          <p>
            These mappings belong to your business. Only confirmed corrections
            become memory.
          </p>
        </div>
        <span className="private-tag">
          <ShieldCheck size={14} />
          Private to you
        </span>
      </div>
      <div className="metrics three">
        <Metric
          title="Learned phrases"
          value={String(memories.length)}
          icon={BrainCircuit}
        />
        <Metric
          title="Approved by your team"
          value={String(memories.filter((m) => m.merchant_approved).length)}
          icon={ShieldCheck}
        />
        <Metric
          title="Successful uses"
          value={String(
            memories.reduce(
              (a, m) =>
                a +
                (m.successful_retrieval_count ||
                  m.times_successfully_reused ||
                  0),
              0,
            ),
          )}
          icon={CheckCheck}
        />
      </div>
      <div className="list-toolbar">
        <div className="tabs">
          {["All memories", "Needs review", "Approved", "Disabled"].map((t) => (
            <button
              className={filter === t ? "selected" : ""}
              key={t}
              onClick={() => setFilter(t)}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="inline-search">
          <Search size={16} />
          <input
            placeholder="Search a phrase…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search memories"
          />
        </div>
      </div>
      <div className="memory-grid">
        {list.map((m) => (
          <article
            className={
              "panel memory-card " + (!m.active ? "disabled-memory" : "")
            }
            key={m.id}
          >
            <div className="memory-card-head">
              <span className="language-pill">{m.language || "es-MX"}</span>
              <Badge
                value={
                  !m.active
                    ? "DISABLED"
                    : m.merchant_approved
                      ? "APPROVED"
                      : m.reliability_level || m.reliability || "NEW"
                }
              />
            </div>
            <div className="phrase">“{m.observed_text}”</div>
            <div className="resolved">
              <ArrowRight size={16} />
              {memoryMeaning(m)}
            </div>
            <div className="memory-stats">
              <div>
                <strong>{m.times_observed || 1}</strong>
                <span>observations</span>
              </div>
              <div>
                <strong>{m.successful_retrieval_count || 0}</strong>
                <span>successful uses</span>
              </div>
              <div>
                <strong>{m.failed_retrieval_count || 0}</strong>
                <span>misses</span>
              </div>
            </div>
            <div className="memory-actions">
              {!m.merchant_approved && m.active ? (
                <button
                  className="text-button"
                  onClick={() => onAction(m.id, "approve")}
                >
                  <Check size={15} />
                  Approve mapping
                </button>
              ) : (
                <span className="muted">
                  {m.merchant_approved
                    ? "Reviewed by your team"
                    : "Not used in conversations"}
                </span>
              )}
              <div>
                <button
                  className="icon-button"
                  title="Edit mapping"
                  onClick={() => setEdit(m)}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="icon-button"
                  title={m.active ? "Disable memory" : "Enable memory"}
                  onClick={() =>
                    onAction(m.id, m.active ? "disable" : "enable")
                  }
                >
                  <Power size={15} />
                </button>
                <button
                  className="icon-button"
                  title="Delete memory"
                  onClick={() => setEdit({ ...m, deleting: true })}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>
      {!list.length && (
        <Empty
          title="Nothing here just yet"
          description="Confirmed corrections from your conversations will appear here."
        />
      )}
      {edit && (
        <Modal
          title={edit.deleting ? "Delete this mapping?" : "Edit learned phrase"}
          onClose={() => setEdit(null)}
        >
          <form
            className="modal-body form"
            onSubmit={async (e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setEditError("");
              try {
                const ok = await onAction(
                  edit.id,
                  edit.deleting ? "delete" : "edit",
                  edit.deleting
                    ? {}
                    : {
                        observed_text: f.get("phrase"),
                        corrected_interpretation: {
                          product: String(f.get("product")),
                          ...(f.get("modifier")
                            ? { modifier: String(f.get("modifier")) }
                            : {}),
                        },
                      },
                );
                if (ok) setEdit(null);
              } catch {
                setEditError(
                  "Please choose a valid menu item and customization.",
                );
              }
            }}
          >
            {edit.deleting ? (
              <p>
                This removes “{edit.observed_text}” from your restaurant’s
                language memory.
              </p>
            ) : (
              <>
                <label>
                  Customer phrase
                  <input
                    name="phrase"
                    defaultValue={edit.observed_text}
                    required
                  />
                </label>
                <label>
                  Menu item
                  <select
                    name="product"
                    required
                    value={
                      edit.corrected_interpretation?.product ||
                      edit.corrected_interpretation?.catalog_item_id ||
                      catalog[0]?.id
                    }
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        corrected_interpretation: { product: e.target.value },
                      })
                    }
                  >
                    {catalog.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Customization
                  <select
                    name="modifier"
                    value={
                      edit.corrected_interpretation?.modifier ||
                      edit.corrected_interpretation?.modifier_id ||
                      ""
                    }
                    onChange={(e) =>
                      setEdit({
                        ...edit,
                        corrected_interpretation: {
                          ...edit.corrected_interpretation,
                          modifier: e.target.value,
                        },
                      })
                    }
                  >
                    <option value="">No customization</option>
                    {(
                      catalog.find(
                        (i) =>
                          i.id ===
                          (edit.corrected_interpretation?.product ||
                            edit.corrected_interpretation?.catalog_item_id ||
                            catalog[0]?.id),
                      )?.modifiers || []
                    ).map((m: Obj) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            )}
            {editError && (
              <p className="inline-error" role="alert">
                {editError}
              </p>
            )}
            <div className="form-actions">
              <button
                type="button"
                className="secondary"
                onClick={() => setEdit(null)}
              >
                Cancel
              </button>
              <button className={edit.deleting ? "danger" : "primary"}>
                {edit.deleting ? "Delete mapping" : "Save mapping"}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
function MenuPage({
  catalog,
  onEdit,
  onToggle,
  onAdd,
  onImport,
  canEdit = true,
}: {
  canEdit?: boolean;
  catalog: Obj[];
  onEdit: (i: Obj) => void;
  onToggle: (i: Obj) => void;
  onAdd: () => void;
  onImport: () => void;
}) {
  const [tab, setTab] = useState("All items");
  const groups = ["All items", ...new Set(catalog.map((c) => c.category))];
  return (
    <>
      <PageHead
        eyebrow="GOOD CONVERSATIONS START HERE"
        title="The menu they know and love."
        description="Your agent orders from this menu. You decide what’s available."
        action={
          canEdit ? (
            <>
              <button className="secondary" onClick={onImport}>
                <Download size={16} />
                Import CSV
              </button>
              <button className="primary" onClick={onAdd}>
                <Plus size={17} />
                Add menu item
              </button>
            </>
          ) : undefined
        }
      />
      <div className="list-toolbar">
        <div className="tabs">
          {groups.map((g) => (
            <button
              key={g}
              onClick={() => setTab(g)}
              className={tab === g ? "selected" : ""}
            >
              {label(g)}
            </button>
          ))}
        </div>
        <span className="muted">
          {catalog.filter((c) => c.available).length} of {catalog.length}{" "}
          available
        </span>
      </div>
      <div className="menu-grid">
        {catalog
          .filter((c) => tab === "All items" || c.category === tab)
          .map((i, n) => (
            <article className="panel menu-card" key={i.id}>
              <div
                className={
                  "menu-illustration " +
                  (/croissant/i.test(i.name) ? "pastry" : "coffee")
                }
              >
                <span className="menu-emoji">
                  {/croissant/i.test(i.name)
                    ? "🥐"
                    : /iced/i.test(i.name)
                      ? "🧋"
                      : "☕"}
                </span>
                <span className="menu-category">{label(i.category)}</span>
                {canEdit && (
                  <button
                    className="icon-button"
                    onClick={() => onEdit(i)}
                    title="Edit menu item"
                  >
                    <MoreHorizontal size={18} />
                  </button>
                )}
              </div>
              <div className="menu-card-content">
                <div className="menu-name">
                  <h3>{i.name}</h3>
                  <strong>{money(i.price)}</strong>
                </div>
                <p>
                  {i.description ||
                    "Made with care. Ordered just the way you like it."}
                </p>
                <div className="menu-modifiers">
                  {i.modifiers?.length
                    ? `${i.modifiers.length} customization options`
                    : "No modifiers"}
                </div>
                <div className="menu-bottom">
                  <span>
                    <i className={i.available ? "green-dot" : "gray-dot"} />
                    {i.available ? "Available to order" : "Sold out"}
                  </span>
                  <button
                    role="switch"
                    aria-checked={i.available}
                    aria-label={`Availability of ${i.name}`}
                    className={"switch " + (i.available ? "on" : "")}
                    onClick={() => onToggle(i)}
                  >
                    <span />
                  </button>
                </div>
              </div>
            </article>
          ))}
      </div>
    </>
  );
}
function MenuEditor({
  item,
  action,
  onClose,
  onDone,
}: {
  item: Obj | null;
  action: (p: string, m: string, b?: unknown) => Promise<any>;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [modifiers, setModifiers] = useState<Obj[]>(item?.modifiers || []);
  return (
    <Modal
      title={item ? "Edit menu item" : "Something new on the menu"}
      subtitle="Prices are always calculated from your menu."
      onClose={onClose}
    >
      <form
        className="modal-body form"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          const body = {
            name: String(f.get("name")),
            price: Number(f.get("price")),
            description: String(f.get("description")),
            category: String(f.get("category")),
            available: f.get("available") === "on",
            ...(item ? { modifiers } : {}),
          };
          const r = await action(
            "/menu" + (item ? "/" + item.id : ""),
            item ? "PATCH" : "POST",
            body,
          );
          setBusy(false);
          if (r) onDone();
        }}
      >
        <label>
          Item name
          <input
            name="name"
            defaultValue={item?.name}
            required
            maxLength={100}
          />
        </label>
        <div className="form-grid">
          <label>
            Price (MXN)
            <input
              type="number"
              name="price"
              min="0"
              max="10000"
              step="0.01"
              defaultValue={item?.price ?? 60}
              required
            />
          </label>
          <label>
            Category
            <input
              name="category"
              defaultValue={item?.category || "Coffee"}
              required
            />
          </label>
        </div>
        <label>
          Description
          <textarea
            name="description"
            defaultValue={item?.description}
            rows={3}
          />
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            name="available"
            defaultChecked={item?.available ?? true}
          />
          Available to order
        </label>
        {modifiers.length > 0 && (
          <div className="modifier-editor">
            <h3>Customizations</h3>
            <p className="field-help">
              Changes apply to this item. Unavailable options cannot be ordered.
            </p>
            {modifiers.map((m, n) => (
              <div key={m.id}>
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={m.available}
                    onChange={(e) =>
                      setModifiers(
                        modifiers.map((v, i) =>
                          i === n ? { ...v, available: e.target.checked } : v,
                        ),
                      )
                    }
                  />
                  {m.name}
                </label>
                <label>
                  Extra MXN
                  <input
                    type="number"
                    aria-label={m.name + " extra price"}
                    min="0"
                    max="500"
                    step="0.01"
                    value={m.price_delta}
                    onChange={(e) =>
                      setModifiers(
                        modifiers.map((v, i) =>
                          i === n
                            ? { ...v, price_delta: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
              </div>
            ))}
          </div>
        )}
        <div className="form-actions">
          <button className="secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary" disabled={busy}>
            {busy ? (
              <Loader2 className="spin" size={16} />
            ) : (
              <Check size={16} />
            )}
            Save item
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Analytics({ data }: { data: Workspace }) {
  const orders = data.orders;
  const confirmed = confirmedOrders(orders as (Obj & { created_at: string })[]);
  const paidOrders = orders.filter(paid);
  const items: Record<string, number> = {};
  orders.forEach((o) =>
    o.items?.forEach((i: Obj) => {
      items[i.name] = (items[i.name] || 0) + i.quantity;
    }),
  );
  const top = Object.entries(items).sort((a, b) => b[1] - a[1]);
  return (
    <>
      <PageHead
        eyebrow="THE BIGGER PICTURE"
        title="Good things, by the numbers."
        description="Understand the conversations that keep your business moving."
      />
      <div className="metrics">
        <Metric
          title="Total sales"
          value={money(paidOrders.reduce((a, o) => a + o.total, 0))}
          icon={CreditCard}
          detail="Confirmed payments only"
        />
        <Metric
          title="Payment conversion"
          value={
            (confirmed.length
              ? Math.round((paidOrders.length / confirmed.length) * 100)
              : 0) + "%"
          }
          icon={ChartNoAxesCombined}
          detail={`${paidOrders.length} paid / ${confirmed.length} confirmed`}
        />
        <Metric
          title="Learned phrases"
          value={String(data.memories.length)}
          icon={BrainCircuit}
          detail="Your private language memory"
        />
        <Metric
          title="Human handoffs"
          value={String(data.escalations.length)}
          icon={Headphones}
          detail="Across all conversations"
        />
      </div>
      <div className="analytics-grid">
        <section className="panel">
          <div className="panel-header">
            <h3>Order activity</h3>
            <span className="muted">By hour · Mexico City</span>
          </div>
          <OrderChart orders={orders} timezone={data.merchant.timezone} />
        </section>
        <section className="panel">
          <div className="panel-header">
            <h3>Counter favorites</h3>
            <UtensilsCrossed size={18} />
          </div>
          <div className="popular-list">
            {top.slice(0, 5).map(([n, v], i) => (
              <div className="popular-item" key={n}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                <div>
                  <strong>{n}</strong>
                  <div className="bar">
                    <i
                      style={{ width: (v / (top[0]?.[1] || 1)) * 100 + "%" }}
                    />
                  </div>
                </div>
                <b>{v}</b>
              </div>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
function OrderDetail({
  order: o,
  data,
  onClose,
  onAction,
  onCustomerLink,
  onReceipt,
  busy,
}: {
  order: Obj;
  data: Workspace;
  onClose: () => void;
  onAction: (a: string) => void;
  onCustomerLink: (method: "POST" | "DELETE") => Promise<Obj | undefined>;
  onReceipt: (
    route: "receipt-link" | "receipt-send",
    method: "POST" | "DELETE",
    body?: unknown,
  ) => Promise<Obj | null | undefined>;
  busy: boolean;
}) {
  const [tab, setTab] = useState("Order");
  const events = data.events.filter((e) => e.order_id === o.id);
  const call = data.calls.find((c) => c.order_id === o.id);
  return (
    <Modal
      wide
      title={o.external_reference || "Order details"}
      subtitle={`Created ${time(o.created_at)} · ${label(o.source || "voice")} order`}
      onClose={onClose}
    >
      <div className="detail-status">
        <Badge value={o.status} />
        <Badge value={o.payment_status} />
        <span>
          {o.currency} {money(o.total)}
        </span>
      </div>
      <div className="detail-tabs tabs">
        {["Order", "Conversation", "Activity"].map((t) => (
          <button
            key={t}
            className={tab === t ? "selected" : ""}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="modal-body">
        {tab === "Order" ? (
          <>
            <div className="detail-customer">
              <div>
                <span className="muted">CUSTOMER</span>
                <h3>{o.customer?.name || "Guest"}</h3>
                <p>{o.customer?.phone || "Phone not provided"}</p>
              </div>
              <div>
                <span className="muted">FULFILLMENT</span>
                <h3>{label(o.fulfillment?.type || "pickup")}</h3>
                <p>
                  {o.fulfillment?.scheduled_for
                    ? time(o.fulfillment.scheduled_for)
                    : "As soon as possible"}
                </p>
              </div>
            </div>
            <div className="detail-items">
              {o.items?.map((i: Obj) => (
                <div key={i.line_id}>
                  <span className="qty-box">{i.quantity}</span>
                  <div>
                    <strong>{i.name}</strong>
                    {i.modifiers?.map((m: Obj) => (
                      <small key={m.modifier_id}>
                        + {m.name} {m.price_delta ? money(m.price_delta) : ""}
                      </small>
                    ))}
                  </div>
                  <strong>
                    {money(
                      (i.unit_price +
                        i.modifiers.reduce(
                          (a: number, m: Obj) => a + m.price_delta,
                          0,
                        )) *
                        i.quantity,
                    )}
                  </strong>
                </div>
              ))}
            </div>
            <div className="order-totals">
              <div>
                <span>Subtotal</span>
                <span>{money(o.subtotal)}</span>
              </div>
              <div>
                <span>Tax</span>
                <span>{money(o.tax)}</span>
              </div>
              {o.fees > 0 && (
                <div>
                  <span>Fees</span>
                  <span>{money(o.fees)}</span>
                </div>
              )}
              <div className="grand-total">
                <strong>Total</strong>
                <strong>
                  {money(o.total)} <small>MXN</small>
                </strong>
              </div>
            </div>
            {o.notes?.length > 0 && (
              <div className="note">
                <FileText size={16} />
                {o.notes.join(" · ")}
              </div>
            )}
            <div className="integration-note">
              <Plug size={16} />
              <span>
                POS:{" "}
                {label(o.pos_status || o.pos_sync_status || "Dashboard only")}
              </span>
            </div>
            {data.user.role === "OWNER" &&
              ![
                "CANCELLED",
                "REFUND_PENDING",
                "REFUNDED",
                "ESCALATED",
              ].includes(o.status) && (
                <CustomerOrderLink
                  key={o.id}
                  busy={busy}
                  expiresAt={o.customer_link?.expires_at}
                  onRequest={onCustomerLink}
                />
              )}
            {data.user.role === "OWNER" &&
              ![
                "DRAFT",
                "AWAITING_CLARIFICATION",
                "AWAITING_CONFIRMATION",
                "ESCALATED",
              ].includes(o.status) && (
                <CustomerReceipt
                  key={`receipt-${o.id}`}
                  orderId={o.id}
                  busy={busy}
                  expiresAt={o.receipt_link?.expires_at}
                  status={o.receipt_notification?.status}
                  retryAllowed={o.receipt_retry_allowed === true}
                  onRequest={onReceipt}
                />
              )}
          </>
        ) : tab === "Conversation" ? (
          <div className="transcript">
            {(call?.turns || o.turns || []).length ? (
              (call?.turns || o.turns).map((t: Obj, i: number) => (
                <div
                  key={i}
                  className={
                    "transcript-line " + (t.role === "user" ? "customer" : "")
                  }
                >
                  <strong>
                    {t.role === "user" ? "Customer" : "Ring Orden"}
                  </strong>
                  <p>{t.content || t.text || t.utterance || t.reply}</p>
                </div>
              ))
            ) : (
              <Empty
                title="No transcript saved"
                description="Test conversations appear here as they’re recorded."
              />
            )}
          </div>
        ) : (
          <div className="timeline">
            <div className="timeline-item">
              <i />
              <div>
                <strong>Order created</strong>
                <p>{time(o.created_at)}</p>
              </div>
            </div>
            {events.map((e, i) => (
              <div className="timeline-item" key={e.id || i}>
                <i />
                <div>
                  <strong>
                    {label(
                      e.type || e.action || e.event_type || "Order updated",
                    )}
                  </strong>
                  <p>{e.message || e.detail || time(e.created_at)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="modal-footer order-actions">
        {!["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status) && (
          <>
            {data.user.role !== "STAFF" &&
              [
                "DRAFT",
                "AWAITING_CLARIFICATION",
                "AWAITING_CONFIRMATION",
                "CONFIRMED",
                "PAYMENT_PENDING",
                "PAID",
                "POS_SYNC_PENDING",
                "POS_SYNCED",
                "POS_SYNC_FAILED",
                "PREPARING",
                "READY",
              ].includes(o.status) && (
                <button
                  className="text-button danger-text"
                  disabled={busy}
                  onClick={() => onAction("cancel")}
                >
                  {o.payment_status === "PAID"
                    ? "Request cancellation"
                    : "Cancel order"}
                </button>
              )}
            <div>
              {data.user.role !== "STAFF" &&
                ["DRAFT", "AWAITING_CONFIRMATION"].includes(o.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => onAction("confirm")}
                  >
                    Confirm order
                  </button>
                )}
              {data.user.role === "OWNER" &&
                o.payment_status === "PENDING" &&
                [
                  "CONFIRMED",
                  "PAYMENT_PENDING",
                  "POS_SYNCED",
                  "POS_SYNC_FAILED",
                ].includes(o.status) && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      onAction(data.mode === "demo" ? "demo_pay" : "checkout")
                    }
                  >
                    <CreditCard size={15} />
                    {data.mode === "demo" ? "Simulate payment" : "Payment link"}
                  </button>
                )}
              {o.payment_status === "PAID" &&
                [
                  "PAID",
                  "POS_SYNCED",
                  "POS_SYNC_FAILED",
                  "POS_SYNC_PENDING",
                ].includes(o.status) && (
                  <button
                    className="primary"
                    disabled={busy}
                    onClick={() => onAction("prepare")}
                  >
                    Start preparing
                    <ArrowRight size={15} />
                  </button>
                )}
              {o.status === "PREPARING" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => onAction("ready")}
                >
                  Mark ready
                  <Check size={15} />
                </button>
              )}
              {o.status === "READY" && (
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => onAction("complete")}
                >
                  Complete order
                  <CheckCheck size={15} />
                </button>
              )}
            </div>
          </>
        )}
        {["COMPLETED", "CANCELLED", "REFUNDED"].includes(o.status) && (
          <button className="secondary" onClick={onClose}>
            Close details
          </button>
        )}
      </div>
    </Modal>
  );
}
function NewOrder({
  catalog,
  action,
  onClose,
  onDone,
}: {
  catalog: Obj[];
  action: (p: string, m: string, b?: unknown) => Promise<any>;
  onClose: () => void;
  onDone: (o: Obj) => void;
}) {
  const [basket, setBasket] = useState<Record<string, number>>({}),
    [busy, setBusy] = useState(false);
  return (
    <Modal
      title="A fresh order"
      subtitle="Add something good to the counter."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          const r = await action("/orders", "POST", {
            customer: { name: f.get("name"), phone: f.get("phone") },
            source: "dashboard",
            items: Object.entries(basket)
              .filter(([, q]) => q > 0)
              .map(([id, q]) => ({ catalog_item_id: id, quantity: q })),
          });
          setBusy(false);
          if (r) onDone(r.order || r);
        }}
      >
        <div className="modal-body form">
          <div className="form-grid">
            <label>
              Customer name
              <input name="name" placeholder="Guest" />
            </label>
            <label>
              Phone (optional)
              <input name="phone" placeholder="+52…" type="tel" />
            </label>
          </div>
          <div className="basket-list">
            {catalog
              .filter((i) => i.available)
              .map((i) => (
                <div key={i.id}>
                  <div>
                    <strong>{i.name}</strong>
                    <small>{money(i.price)}</small>
                  </div>
                  <div className="stepper">
                    <button
                      type="button"
                      aria-label={"Remove " + i.name}
                      onClick={() =>
                        setBasket({
                          ...basket,
                          [i.id]: Math.max(0, (basket[i.id] || 0) - 1),
                        })
                      }
                    >
                      −
                    </button>
                    <span>{basket[i.id] || 0}</span>
                    <button
                      type="button"
                      aria-label={"Add " + i.name}
                      onClick={() =>
                        setBasket({
                          ...basket,
                          [i.id]: Math.min(20, (basket[i.id] || 0) + 1),
                        })
                      }
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
          </div>
        </div>
        <div className="modal-footer">
          <strong>
            {money(
              catalog.reduce((a, i) => a + i.price * (basket[i.id] || 0), 0),
            )}{" "}
            MXN
          </strong>
          <button
            className="primary"
            disabled={busy || !Object.values(basket).some((v) => v > 0)}
          >
            {busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />}
            Create order
          </button>
        </div>
      </form>
    </Modal>
  );
}
function Simulator({
  data,
  onClose,
  onUpdate,
  notify,
}: {
  data: Workspace;
  onClose: () => void;
  onUpdate: () => Promise<void>;
  notify: (s: string) => void;
}) {
  const [session, setSession] = useState<Obj | null>(null),
    [turns, setTurns] = useState<Obj[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [err, setErr] = useState(""),
    [voice, setVoice] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    api("/sessions", "POST", {})
      .then((s) => {
        setSession(s);
        setTurns([
          {
            role: "assistant",
            content: `Thanks for calling ${data.merchant.name}! What can I get started for you?`,
          },
        ]);
      })
      .catch((e) => setErr(e.message));
  }, [data.merchant.name]);
  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns]);
  useEffect(
    () => () => {
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    },
    [],
  );
  const send = async (text: string) => {
    if (!session || busy || !text.trim()) return;
    setInput("");
    setBusy(true);
    setErr("");
    setTurns((t) => [...t, { role: "user", content: text }]);
    try {
      const r = await api("/sessions/" + session.id + "/turn", "POST", {
        utterance: text,
        request_id: crypto.randomUUID(),
      });
      setSession({ ...session, order: r.order });
      setTurns((t) => [...t, { role: "assistant", content: r.reply }]);
      await onUpdate();
      if (voice && typeof speechSynthesis !== "undefined") {
        const u = new SpeechSynthesisUtterance(r.reply);
        u.lang = "en-US";
        speechSynthesis.speak(u);
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const suggestions =
    turns.length < 2
      ? [
          "Two iced lattes, both oat, and a chocolate croissant.",
          "Me regalas un latte.",
          "I’d like to speak to a person.",
        ]
      : [
          "Make the second latte regular milk.",
          "Make the first one decaf.",
          "Add an extra shot.",
          "The first one.",
          "Yes, confirm my order.",
        ];
  const o = session?.order;
  return (
    <Modal
      wide
      title="Give your agent a ring"
      subtitle="A real ordering flow, with a little room to experiment."
      onClose={onClose}
    >
      <div className="simulator-banner">
        <Radio size={15} />
        {data.mode === "demo"
          ? "Interactive demo · Text conversation · No phone or payment charges"
          : "Test conversation"}
        <button
          className={"text-button " + (voice ? "is-paid" : "")}
          onClick={() => {
            setVoice(!voice);
            if (voice && typeof speechSynthesis !== "undefined")
              speechSynthesis.cancel();
          }}
        >
          <Volume2 size={15} />
          {voice ? "Read aloud on" : "Read aloud"}
        </button>
      </div>
      <div className="simulator-grid">
        <div className="chat-side">
          <div className="chat-scroll">
            {turns.map((t, i) => (
              <div key={i} className={"chat-message " + t.role}>
                {t.role === "assistant" && (
                  <span className="chat-agent">
                    <AudioLines size={15} />
                  </span>
                )}
                <div>
                  <small>{t.role === "assistant" ? "RING ORDEN" : "YOU"}</small>
                  <p>{t.content}</p>
                </div>
              </div>
            ))}
            {busy && (
              <div className="thinking">
                <span />
                <span />
                <span />
              </div>
            )}
            {err && <div className="inline-error">{err}</div>}
            <div ref={end} />
          </div>
          <div className="suggestions">
            {suggestions.map((s) => (
              <button
                key={s}
                disabled={busy || !session}
                onClick={() => send(s)}
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <input
              autoFocus
              placeholder="Place an order. Change your mind. Try Spanglish."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={!session}
              aria-label="Message to ordering agent"
            />
            <button
              className="primary"
              disabled={!session || busy || !input.trim()}
              aria-label="Send message"
            >
              <Send size={17} />
            </button>
          </form>
        </div>
        <div className="live-order">
          <div className="eyebrow">THE ORDER, AS IT HAPPENS</div>
          <div className="live-order-title">
            <h3>Your order</h3>
            {o && <Badge value={o.status} />}
          </div>
          {o?.items?.length ? (
            <>
              <div className="live-order-items">
                {o.items.map((i: Obj, n: number) => (
                  <div key={i.line_id}>
                    <span>{String(n + 1).padStart(2, "0")}</span>
                    <div>
                      <strong>{i.name}</strong>
                      {i.modifiers.map((m: Obj) => (
                        <small key={m.modifier_id}>{m.name}</small>
                      ))}
                    </div>
                    <b>
                      {money(
                        i.unit_price +
                          i.modifiers.reduce(
                            (a: number, m: Obj) => a + m.price_delta,
                            0,
                          ),
                      )}
                    </b>
                  </div>
                ))}
              </div>
              <div className="live-order-total">
                <span>Total</span>
                <strong>
                  {money(o.total)} <small>MXN</small>
                </strong>
              </div>
            </>
          ) : (
            <div className="empty-basket">
              <ShoppingBag size={29} />
              <p>
                Something delicious
                <br />
                is about to happen.
              </p>
            </div>
          )}
          <div className="order-assurance">
            <ShieldCheck size={15} />
            <span>
              Menu prices. Explicit confirmation.
              <br />
              Every change stays in your control.
            </span>
          </div>
          {o &&
            [
              "CONFIRMED",
              "PAYMENT_PENDING",
              "POS_SYNCED",
              "POS_SYNC_FAILED",
            ].includes(o.status) &&
            o.payment_status !== "PAID" && (
              <button
                className="primary full"
                onClick={async () => {
                  try {
                    const r = await api("/orders/" + o.id + "/action", "POST", {
                      action: data.mode === "demo" ? "demo_pay" : "checkout",
                    });
                    setSession({ ...session, order: r.order });
                    if (r.checkout_url)
                      setSession({
                        ...session,
                        order: { ...r.order, checkout_url: r.checkout_url },
                      });
                    await onUpdate();
                    notify(
                      data.mode === "demo"
                        ? "Demo payment recorded. No money charged."
                        : "Your payment link is ready in order details.",
                    );
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                <CreditCard size={16} />
                {data.mode === "demo"
                  ? "Simulate payment"
                  : "Open payment link"}
              </button>
            )}
          {o?.checkout_url && o.payment_status !== "PAID" && (
            <a
              className="secondary full"
              style={{ marginTop: 12 }}
              href={o.checkout_url}
              target="_blank"
              rel="noopener noreferrer"
            >
              Open payment link <ExternalLink size={15} />
            </a>
          )}
          {o?.payment_status === "PAID" && (
            <div className="paid-confirmation">
              <CheckCircle2 size={19} />
              Paid. Ready for your counter.
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
