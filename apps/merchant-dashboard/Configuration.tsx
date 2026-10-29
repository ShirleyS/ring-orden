"use client";
import React, { useState } from "react";
import {
  AudioLines,
  ArrowRight,
  ArrowUpRight,
  ArrowLeft,
  Check,
  CheckCircle2,
  Phone,
  Headphones,
  ShieldCheck,
  Zap,
  Plug,
  Plus,
  CreditCard,
  Bell,
  Mail,
  Globe,
  KeyRound,
  LockKeyhole,
  Play,
  RefreshCw,
  Loader2,
  ExternalLink,
  Copy,
  Users,
  Settings,
  ChevronRight,
  Code2,
  BookOpen,
  AlertTriangle,
  MessageCircle,
  Activity,
  Download,
} from "lucide-react";
import { Obj, Workspace, money, label, time } from "./types";
import { PageHead, Badge, Modal, Empty } from "./App";
import BusinessHours from "./BusinessHours";
import { pendingPayments } from "./reporting";
type Props = {
  page: string;
  data: Workspace;
  action: (p: string, m: string, b?: unknown) => Promise<any>;
  notify: (s: string) => void;
  onTest: () => void;
  onOnboard: () => void;
  onVoice: () => void;
};
const vendorColors: Record<string, string> = {
  deepseek: "#536cef",
  elevenlabs: "#222",
  stripe: "#635bff",
  twilio: "#ed4057",
  square: "#222",
  supabase: "#32a77a",
  mojoauth: "#8c52cc",
  firecrawl: "#f06c2d",
  n8n: "#ea6d7c",
  webhook: "#927047",
};
export function Configuration({
  page,
  data,
  action,
  notify,
  onTest,
  onOnboard,
  onVoice,
}: Props) {
  const [dialog, setDialog] = useState<string | null>(null),
    [tab, setTab] = useState("All integrations"),
    [testing, setTesting] = useState(false),
    [result, setResult] = useState<Obj | null>(null);
  const s = data.settings;
  const model = s.model || {};
  const save = async (section: string, values: Obj) => {
    const r = await action("/settings", "PATCH", { section, values });
    if (r) {
      notify("Your settings are saved.");
      setDialog(null);
    }
    return r;
  };
  const test = async (path: string) => {
    setTesting(true);
    const r = await action(path, "POST", {});
    if (r) {
      setResult(r);
      notify(r.message || "Connection test finished.");
    }
    setTesting(false);
  };
  return (
    <>
      {page === "Phone & agent" && (
        <>
          <PageHead
            eyebrow="YOUR NEW FAVORITE TEAMMATE"
            title="A voice that feels like you."
            description="A warm welcome, every time your phone rings."
            action={
              <>
                <button className="secondary" onClick={onTest}>
                  <Play size={16} />
                  Text test
                </button>
                <button className="primary" onClick={onVoice}>
                  <Phone size={16} />
                  Voice call
                </button>
              </>
            }
          />
          <section className="panel whatsapp-widget-panel">
            <div className="panel-header">
              <h3><MessageCircle size={20} /> WhatsApp test widget</h3>
              <Badge value="demo" />
            </div>
            <div className="whatsapp-widget-content">
              <p>Call Ring Orden and receive order messages on your test phone.</p>
              <p className="muted">+52 55 91100000 · Demo number</p>
              <div className="settings-list">
                <Setting label="WhatsApp webhook (n8n)" value={data.whatsapp_widget?.webhook_added ? "•••••••• · Added" : "Not added"} />
                <Setting label="Webhook authentication" value={data.whatsapp_widget?.webhook_auth_added ? "•••••••• · Added" : "Not added"} />
                <Setting label="Public key (ElevenLabs agent ID)" value={data.whatsapp_widget?.public_key_added ? "•••••••• · Added" : "Not added"} />
              </div>
              <p className="muted">Uses your saved Ring Orden configuration. Values stay hidden. Added means saved; delivery is checked during a test.</p>
              <label htmlFor="whatsapp-widget-link">Widget link</label>
              <input id="whatsapp-widget-link" readOnly value={typeof window === "undefined" ? "" : `${window.location.origin}/app?phone=whatsapp`} />
              <div className="whatsapp-widget-actions">
                <button className="primary" onClick={onVoice}><MessageCircle size={16} /> Open WhatsApp widget</button>
                <button className="secondary" onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(`${window.location.origin}/app?phone=whatsapp`);
                    notify("WhatsApp widget link copied.");
                  } catch { notify("Select the widget link above to copy it."); }
                }}><Copy size={16} /> Copy link</button>
              </div>
            </div>
          </section>
          <div className="config-grid">
            <section className="panel phone-panel">
              <div className="panel-header">
                <h3>Your ordering line</h3>
                <Badge value={s.phone?.status || "setup_required"} />
              </div>
              <div className="phone-number">
                <span className="phone-circle">
                  <Phone size={24} />
                </span>
                <h2>
                  {s.phone?.ordering_phone || "Your next hello starts here."}
                </h2>
                <p>
                  {s.phone?.ordering_phone
                    ? "Customers call this number to place an order."
                    : "Connect a number or forward the one your customers already know."}
                </p>
                <button className="primary" onClick={() => setDialog("phone")}>
                  <Plus size={16} />
                  {s.phone?.ordering_phone
                    ? "Manage phone number"
                    : "Set up your phone"}
                </button>
              </div>
              <div className="phone-bottom">
                <ShieldCheck size={17} />
                <span>
                  Ordering and notification numbers are kept separate.
                </span>
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h3>Meet your agent</h3>
                <span className="agent-avatar">
                  <AudioLines size={20} />
                </span>
              </div>
              <div className="settings-list">
                <Setting
                  label="Languages"
                  value={(s.agent?.languages || ["es-MX", "en-US"])
                    .map(label)
                    .join(" · ")}
                />
                <Setting
                  label="Voice & tone"
                  value={s.agent?.voice || "Warm & conversational"}
                />
                <Setting
                  label="Pickup estimate"
                  value={`${s.agent?.pickup_minutes || 15} minutes`}
                />
                <Setting
                  label="Human handoff"
                  value={s.agent?.handoff_number || "Callback ticket"}
                />
                <Setting
                  label="After hours"
                  value={label(s.agent?.after_hours || "information_only")}
                />
              </div>
              <div className="panel-footer">
                <button
                  className="secondary"
                  onClick={() => setDialog("agent")}
                >
                  Customize your agent
                  <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          </div>
          <section className="panel greeting-panel">
            <div>
              <div className="eyebrow">A FIRST IMPRESSION THAT LASTS</div>
              <h3>
                “
                {s.agent?.greeting ||
                  "Hi there! What can I get started for you?"}
                ”
              </h3>
              <p>
                Your opening greeting. A little personality goes a long way.
              </p>
            </div>
            <button className="secondary" onClick={() => setDialog("agent")}>
              Edit greeting
            </button>
          </section>
          <div className="info-banner">
            <Headphones size={18} />
            <p>
              When a conversation needs a person, your agent can create a
              callback ticket. Live transfer requires your telephony setup.
            </p>
          </div>
        </>
      )}
      {page === "AI model" && (
        <>
          <PageHead
            eyebrow="YOUR BRAIN. YOUR CHOICE."
            title="Good conversations, open possibilities."
            description="Choose the intelligence behind your counter. Switch when you want."
            action={
              <button
                className="secondary"
                disabled={testing}
                onClick={() => test("/models/test")}
              >
                {testing ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Play size={16} />
                )}
                Run compatibility test
              </button>
            }
          />
          <div className="model-hero panel">
            <div
              className="provider-logo"
              style={{ background: "#eef1ff", color: "#536cef" }}
            >
              <Zap size={34} />
            </div>
            <div>
              <div className="eyebrow">YOUR SELECTED MODEL</div>
              <h2>{model.model || "deepseek-flash"}</h2>
              <p>
                {label(model.provider || "DeepSeek")} ·{" "}
                {model.hosting === "self-hosted"
                  ? "Self hosted"
                  : "Hosted model"}
              </p>
            </div>
            <Badge
              value={
                model.has_api_key
                  ? "CONFIGURED"
                  : model.status || "setup_required"
              }
            />
            <button className="primary" onClick={() => setDialog("model")}>
              <SlidersIcon />
              Configure model
            </button>
          </div>
          <div className="config-grid">
            <section className="panel">
              <div className="panel-header">
                <h3>Open by design.</h3>
                <Code2 size={19} />
              </div>
              <div className="panel-body">
                <p>
                  DeepSeek is the recommended starting point. Bring Qwen,
                  Ollama, vLLM, SGLang, or any compatible endpoint when you’re
                  ready.
                </p>
                <div className="provider-chips">
                  {[
                    "DeepSeek",
                    "Qwen",
                    "Ollama",
                    "vLLM",
                    "SGLang",
                    "Custom endpoint",
                  ].map((p) => (
                    <span key={p}>{p}</span>
                  ))}
                </div>
                <button
                  className="text-button"
                  onClick={() => setDialog("model")}
                >
                  Bring your own model <ArrowRight size={15} />
                </button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h3>Your privacy, your call.</h3>
                <ShieldCheck size={19} />
              </div>
              <div className="panel-body">
                <p>
                  Keep interpretation on your own infrastructure. External
                  fallback only runs when you enable it.
                </p>
                <div className="privacy-setting">
                  <div>
                    <strong>External fallback</strong>
                    <small>
                      {model.fallback_enabled
                        ? "May use DeepSeek when the primary model fails."
                        : "Your model stays your model."}
                    </small>
                  </div>
                  <button
                    className={"switch " + (model.fallback_enabled ? "on" : "")}
                    role="switch"
                    aria-checked={!!model.fallback_enabled}
                    aria-label="Enable external fallback"
                    onClick={() =>
                      save("model", {
                        fallback_enabled: !model.fallback_enabled,
                      })
                    }
                  >
                    <span />
                  </button>
                </div>
              </div>
            </section>
          </div>
          <section className="panel">
            <div className="panel-header">
              <h3>Compatibility, measured.</h3>
              <span className="muted">Test before switching</span>
            </div>
            {result || model.last_test ? (
              <div className="panel-body">
                <pre className="result-json">
                  {JSON.stringify(result || model.last_test, null, 2)}
                </pre>
              </div>
            ) : (
              <Empty
                title="Let’s get to know your model"
                description="Connect a model, then test structured orders, corrections, references, and multilingual conversations."
                action={
                  <button
                    className="secondary"
                    onClick={() => setDialog("model")}
                  >
                    Connect your model <ArrowRight size={15} />
                  </button>
                }
              />
            )}
          </section>
        </>
      )}
      {page === "Integrations" && (
        <>
          <PageHead
            eyebrow="YOUR TOOLS. WORKING TOGETHER."
            title="Fits right into your counter."
            description="Keep the systems you love. Connect the ones you need."
            action={
              <button className="secondary" onClick={onOnboard}>
                Setup guide <ArrowUpRight size={15} />
              </button>
            }
          />
          <div className="list-toolbar">
            <div className="tabs">
              {[
                "All integrations",
                "Point of sale",
                "AI & voice",
                "Payments & messaging",
              ].map((t) => (
                <button
                  key={t}
                  className={tab === t ? "selected" : ""}
                  onClick={() => setTab(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            <span className="muted">Server-side connections</span>
          </div>
          <div className="integrations-grid">
            {data.integrations
              .filter(
                (i) =>
                  tab === "All integrations" ||
                  (tab === "Point of sale" && /sale|pos/i.test(i.category)) ||
                  (tab === "AI & voice" &&
                    /voice|model|phone/i.test(i.category)) ||
                  (tab === "Payments & messaging" &&
                    /payment|messag|notification/i.test(i.category)),
              )
              .map((i) => (
                <article className="panel integration-card" key={i.id}>
                  <div className="integration-top">
                    <span
                      className="vendor-mark"
                      style={{
                        color: vendorColors[i.id] || "#7e3d4b",
                        background: (vendorColors[i.id] || "#7e3d4b") + "10",
                      }}
                    >
                      {i.id === "elevenlabs"
                        ? "Ⅱ"
                        : i.id === "stripe"
                          ? "S"
                          : i.id === "square"
                            ? "▣"
                            : i.id === "n8n"
                              ? "n8n"
                              : i.name.slice(0, 2)}
                    </span>
                    <Badge
                      value={i.configured ? "CONFIGURED" : "setup_required"}
                    />
                  </div>
                  <h3>{i.name}</h3>
                  <p>{i.description}</p>
                  <div className="integration-foot">
                    <span>{i.category}</span>
                    <button
                      className="text-button"
                      onClick={() =>
                        setDialog(i.id === "webhook" ? "pos" : i.id)
                      }
                    >
                      Configure <ArrowUpRight size={14} />
                    </button>
                  </div>
                </article>
              ))}
          </div>
          <section className="panel pos-settings">
            <div>
              <h3>Where should your orders land?</h3>
              <p>
                Choose your POS or keep everything right here in your dashboard.
              </p>
            </div>
            <button className="secondary" onClick={() => setDialog("pos")}>
              Order delivery settings <ArrowRight size={15} />
            </button>
          </section>
          <div className="info-banner">
            <Plug size={18} />
            <p>
              Square and custom webhooks have write adapters. PoloTab, Parrot,
              and Zettle are extension points awaiting provider verification.
            </p>
          </div>
        </>
      )}
      {page === "Payments" && (
        <>
          <PageHead
            eyebrow="FROM ORDERED TO PAID"
            title="One less thing on your plate."
            description="Payment links, clear statuses, and every peso accounted for."
            action={
              <button
                className="secondary"
                onClick={() => setDialog("payments")}
              >
                <CreditCard size={16} />
                Payment settings
              </button>
            }
          />
          <div className="payment-summary">
            <div className="panel">
              <span className="eyebrow">COLLECTED</span>
              <h2>
                {money(
                  data.orders
                    .filter((o) => o.payment_status === "PAID")
                    .reduce((a, o) => a + o.total, 0),
                )}
                <small> MXN</small>
              </h2>
              <p>
                {data.orders.filter((o) => o.payment_status === "PAID").length}{" "}
                paid orders
              </p>
            </div>
            <div className="panel">
              <span className="eyebrow">AWAITING PAYMENT</span>
              <h2>
                {money(
                  pendingPayments(
                    data.orders as (Obj & { created_at: string })[],
                  ).reduce((a, o) => a + o.total, 0),
                )}
                <small> MXN</small>
              </h2>
              <p>
                {
                  pendingPayments(
                    data.orders as (Obj & { created_at: string })[],
                  ).length
                }{" "}
                pending orders
              </p>
            </div>
            <div className="panel stripe-card">
              <span className="stripe-word">stripe</span>
              <Badge value="TEST_MODE" />
              <p>
                {data.mode === "demo"
                  ? "Demo payment events are simulated. No money is charged."
                  : "Checkout uses Stripe test mode."}
              </p>
              <button
                className="text-button"
                onClick={() => setDialog("stripe")}
              >
                Connection details
                <ArrowUpRight size={14} />
              </button>
            </div>
          </div>
          <section className="panel">
            <div className="panel-header">
              <h3>Payment activity</h3>
              <span className="muted">
                {data.mode === "demo"
                  ? "Demo transactions"
                  : "All transactions"}
              </span>
            </div>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>ORDER</th>
                    <th>CUSTOMER</th>
                    <th>DATE</th>
                    <th>AMOUNT</th>
                    <th>STATUS</th>
                    <th>METHOD</th>
                  </tr>
                </thead>
                <tbody>
                  {data.orders
                    .filter(
                      (o) =>
                        !["DRAFT", "AWAITING_CLARIFICATION"].includes(o.status),
                    )
                    .map((o) => (
                      <tr key={o.id}>
                        <td>
                          <strong>{o.external_reference}</strong>
                        </td>
                        <td>{o.customer?.name || "Guest"}</td>
                        <td>{time(o.updated_at)}</td>
                        <td className="amount">{money(o.total)}</td>
                        <td>
                          <Badge value={o.payment_status} />
                        </td>
                        <td>
                          <span className="muted">
                            {data.mode === "demo"
                              ? "Simulated"
                              : "Stripe Checkout"}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="info-banner">
            <ShieldCheck size={18} />
            <p>
              Real payment status comes from a verified Stripe webhook. Opening
              a success page never marks an order as paid.
            </p>
          </div>
        </>
      )}
      {page === "Notifications" && (
        <>
          <PageHead
            eyebrow="KEEP EVERYONE IN THE LOOP"
            title="The right update. Right on time."
            description="An order confirmation for your guest. A heads-up for your team."
          />
          <div className="config-grid">
            <section className="panel">
              <div className="panel-header">
                <h3>Customer updates</h3>
                <MessageCircle size={19} />
              </div>
              <div className="panel-body">
                <p>
                  After confirmation, send an order summary, pickup details, and
                  a payment link.
                </p>
                {[
                  [
                    "whatsapp",
                    "WhatsApp",
                    "Order updates through Twilio WhatsApp.",
                  ],
                  [
                    "sms",
                    "Text message",
                    "Coming soon · SMS delivery is not active.",
                  ],
                  [
                    "email",
                    "Email",
                    "Coming soon · Email delivery is not active.",
                  ],
                ].map(([key, name, desc]) => (
                  <div className="toggle-row" key={key}>
                    <div>
                      <strong>{name}</strong>
                      <small>{desc}</small>
                    </div>
                    <button
                      className={
                        "switch " + (s.notifications?.[key] ? "on" : "")
                      }
                      role="switch"
                      aria-checked={
                        key === "whatsapp" && !!s.notifications?.[key]
                      }
                      aria-label={name + " notifications"}
                      disabled={key !== "whatsapp"}
                      onClick={() =>
                        save("notifications", {
                          [key]: !s.notifications?.[key],
                        })
                      }
                    >
                      <span />
                    </button>
                  </div>
                ))}
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h3>Team alerts</h3>
                <Bell size={18} />
              </div>
              <div className="panel-body">
                <p>
                  Your team’s notification number is separate from the customer
                  ordering line.
                </p>
                <div className="saved-value">
                  <Phone size={18} />
                  <strong>
                    {s.notifications?.manager_phone ||
                      "No notification number yet"}
                  </strong>
                </div>
                <p>
                  Escalations and delivery failures stay visible in your
                  workspace.
                </p>
                <button
                  className="secondary"
                  onClick={() => setDialog("notifications")}
                >
                  Manage alerts <ArrowUpRight size={15} />
                </button>
              </div>
            </section>
          </div>
        </>
      )}
      {page === "Team" && (
        <>
          <PageHead
            eyebrow="BETTER, TOGETHER"
            title="The people behind the counter."
            description="The right access for everyone on your team."
            action={
              <button className="primary" onClick={() => setDialog("team")}>
                <Plus size={16} />
                Add team member
              </button>
            }
          />
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>MEMBER</th>
                    <th>EMAIL</th>
                    <th>ROLE</th>
                    <th>ACCESS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.team.map((t) => (
                    <tr key={t.id}>
                      <td>
                        <div className="cell-person">
                          <span className="small-avatar">
                            {t.name.slice(0, 1)}
                          </span>
                          <strong>{t.name}</strong>
                        </div>
                      </td>
                      <td>{t.email}</td>
                      <td>
                        <Badge value={t.role} />
                      </td>
                      <td>{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <div className="role-grid">
            {[
              [
                "Owner",
                "Business settings, connections, payments, and your team.",
              ],
              [
                "Manager",
                "Orders, availability, memory approvals, and escalations.",
              ],
              ["Staff", "Active orders and basic conversation status."],
            ].map(([role, desc]) => (
              <section className="panel" key={role}>
                <ShieldCheck size={21} />
                <h3>{role}</h3>
                <p>{desc}</p>
              </section>
            ))}
          </div>
          <div className="info-banner">
            <LockKeyhole size={18} />
            <p>
              Invite links are single-use and require the matching verified
              email. Your hosting access settings still apply.
            </p>
          </div>
        </>
      )}
      {page === "Settings" && (
        <>
          <PageHead
            eyebrow="MAKE YOURSELF AT HOME"
            title="Your business, your way."
            description="The details that make your restaurant yours."
            action={
              <button className="secondary" onClick={onOnboard}>
                Open setup guide <ArrowRight size={15} />
              </button>
            }
          />
          <div className="config-grid">
            <section className="panel">
              <div className="panel-header">
                <h3>Business profile</h3>
                <button
                  className="text-button"
                  onClick={() => setDialog("business")}
                >
                  Edit profile <ArrowUpRight size={14} />
                </button>
              </div>
              <div className="settings-list">
                <Setting label="Business name" value={data.merchant.name} />
                <Setting
                  label="Address"
                  value={s.business?.address || data.merchant.address}
                />
                <Setting
                  label="Timezone"
                  value={s.business?.timezone || "America/Mexico_City"}
                />
                <Setting
                  label="Currency"
                  value={s.business?.currency || "MXN"}
                />
                <Setting
                  label="Default language"
                  value={s.business?.language || "es-MX"}
                />
                <Setting
                  label="Business hours"
                  value={s.business?.hours || "Not set"}
                />
              </div>
              <div className="panel-footer">
                <button
                  className="secondary"
                  onClick={() => setDialog("hours")}
                >
                  Edit opening hours
                </button>
              </div>
            </section>
            <section className="panel">
              <div className="panel-header">
                <h3>Order guardrails</h3>
                <ShieldCheck size={18} />
              </div>
              <div className="settings-list">
                <Setting
                  label="Minimum order"
                  value={money(s.business?.minimum_order || 0)}
                />
                <Setting
                  label="Maximum order"
                  value={money(s.business?.maximum_order || 5000)}
                />
                <Setting
                  label="Maximum items"
                  value={String(s.business?.maximum_quantity || 50)}
                />
                <Setting
                  label="Tax rate"
                  value={`${(s.business?.tax_rate || 0) * 100}%`}
                />
                <Setting label="Price authority" value="Your menu, always" />
              </div>
              <div className="panel-footer">
                <button
                  className="secondary"
                  onClick={() => setDialog("rules")}
                >
                  Edit order rules
                </button>
              </div>
            </section>
          </div>
          <section className="panel privacy-panel">
            <ShieldCheck size={26} />
            <div>
              <h3>Your data stays yours.</h3>
              <p>
                Private merchant memory. Server-side credentials. Isolated
                workspaces. Open-source software.
              </p>
            </div>
            <span className="private-tag">MIT licensed</span>
          </section>
        </>
      )}
      {page === "Diagnostics" && (
        <>
          <PageHead
            eyebrow="A LOOK UNDER THE HOOD"
            title="Everything, accounted for."
            description="Connection health, delivery events, and the details your team needs."
            action={
              <button
                className="secondary"
                onClick={() => window.location.reload()}
              >
                <RefreshCw size={16} />
                Refresh
              </button>
            }
          />
          <div className="health-grid">
            {data.integrations.map((i) => (
              <div className="panel health-card" key={i.id}>
                <strong>{i.name}</strong>
                <Badge value={i.configured ? "CONFIGURED" : "setup_required"} />
              </div>
            ))}
          </div>
          <section className="panel">
            <div className="panel-header">
              <h3>Workspace event log</h3>
              <Activity size={18} />
            </div>
            <div className="event-list">
              {data.events.map((e) => (
                <div key={e.id}>
                  <span
                    className={
                      "event-dot " + (e.level === "error" ? "red" : "")
                    }
                  />
                  <div>
                    <strong>{e.title || label(e.type)}</strong>
                    <p>{e.detail || e.message}</p>
                  </div>
                  <small>{time(e.created_at)}</small>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
      {dialog === "hours" && (
        <BusinessHours
          business={s.business || {}}
          onClose={() => setDialog(null)}
          onSave={(values) => save("business", values)}
        />
      )}
      {dialog && dialog !== "hours" && (
        <ConfigDialog
          kind={dialog}
          data={data}
          save={save}
          action={action}
          onClose={() => setDialog(null)}
          test={test}
          testing={testing}
          notify={notify}
        />
      )}
    </>
  );
}
function SlidersIcon() {
  return <Settings size={16} />;
}
function Setting({ label: heading, value }: { label: string; value: string }) {
  return (
    <div className="setting-row">
      <span>{heading}</span>
      <strong>{value || "Not configured"}</strong>
    </div>
  );
}
function ConfigDialog({
  kind,
  data,
  save,
  action,
  onClose,
  test,
  testing,
  notify,
}: {
  kind: string;
  data: Workspace;
  save: (s: string, v: Obj) => Promise<any>;
  action: Props["action"];
  onClose: () => void;
  test: (p: string) => void;
  testing: boolean;
  notify: (s: string) => void;
}) {
  const [saving, setSaving] = useState(false),
    [inviteUrl, setInviteUrl] = useState("");
  const s = data.settings;
  const section =
    kind === "rules" ? "business" : kind === "stripe" ? "payments" : kind;
  const v = s[section] || {};
  const known = [
    "business",
    "rules",
    "agent",
    "model",
    "phone",
    "pos",
    "notifications",
    "payments",
    "team",
  ];
  const integration = data.integrations.find((i) => i.id === kind);
  return (
    <Modal
      title={
        kind === "model"
          ? "Choose your model"
          : kind === "team"
            ? "Add a teammate"
            : kind === "phone"
              ? "Your ordering line"
              : kind === "pos"
                ? "Order delivery"
                : kind === "rules"
                  ? "Order guardrails"
                  : integration
                    ? integration.name
                    : label(kind) + " settings"
      }
      subtitle={
        kind === "model"
          ? "Open infrastructure. Your choice of intelligence."
          : kind === "team"
            ? "Invite your teammate with a private, single-use link."
            : "Your changes are saved securely to this workspace."
      }
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setSaving(true);
          const f = new FormData(e.currentTarget);
          const values: Obj = {};
          f.forEach((val, key) => {
            if (!key.startsWith("map__")) values[key] = val;
          });
          if (kind === "pos") {
            values.catalog_mappings = {};
            f.forEach((val, key) => {
              if (key.startsWith("map__") && String(val).trim())
                values.catalog_mappings[key.slice(5)] = String(val).trim();
            });
          }
          for (const key of [
            "pickup_minutes",
            "timeout_ms",
            "minimum_order",
            "maximum_order",
            "maximum_quantity",
          ])
            if (key in values) values[key] = Number(values[key]);
          if ("tax_rate" in values)
            values.tax_rate = Number(values.tax_rate) / 100;
          if ("languages" in values)
            values.languages = String(values.languages)
              .split(",")
              .map((x: string) => x.trim())
              .filter(Boolean);
          if (kind === "model")
            values.fallback_enabled = f.get("fallback_enabled") === "on";
          if (kind === "team") {
            const r = await action("/team", "POST", values);
            if (r) {
              setInviteUrl(r.invite_url || "");
              notify("Invitation created. Share the link with your teammate.");
            }
          } else if (known.includes(kind) || kind === "stripe")
            await save(section, values);
          setSaving(false);
        }}
      >
        <div className="modal-body form">
          {kind === "business" && (
            <>
              <label>
                Business name
                <input
                  name="name"
                  defaultValue={v.name || data.merchant.name}
                  required
                />
              </label>
              <label>
                Address
                <input name="address" defaultValue={v.address} />
              </label>
              <div className="form-grid">
                <label>
                  Timezone
                  <select
                    name="timezone"
                    defaultValue={v.timezone || "America/Mexico_City"}
                  >
                    <option>America/Mexico_City</option>
                    <option>America/New_York</option>
                    <option>America/Los_Angeles</option>
                    <option>America/Chicago</option>
                    <option>Europe/Madrid</option>
                  </select>
                </label>
                <label>
                  Language
                  <select name="language" defaultValue={v.language || "es-MX"}>
                    <option value="es-MX">Spanish (Mexico)</option>
                    <option value="en-US">English (US)</option>
                  </select>
                </label>
              </div>
              <label>
                Currency
                <select name="currency" defaultValue="MXN">
                  <option>MXN</option>
                </select>
              </label>
              <label>
                Business hours
                <input name="hours" defaultValue={v.hours} />
              </label>
            </>
          )}
          {kind === "rules" && (
            <>
              <div className="form-grid">
                <label>
                  Minimum order (MXN)
                  <input
                    name="minimum_order"
                    type="number"
                    min="0"
                    defaultValue={v.minimum_order || 0}
                  />
                </label>
                <label>
                  Maximum order (MXN)
                  <input
                    name="maximum_order"
                    type="number"
                    min="1"
                    defaultValue={v.maximum_order || 5000}
                  />
                </label>
              </div>
              <div className="form-grid">
                <label>
                  Maximum items
                  <input
                    name="maximum_quantity"
                    type="number"
                    min="1"
                    max="50"
                    defaultValue={v.maximum_quantity || 50}
                  />
                </label>
                <label>
                  Tax rate (%)
                  <input
                    name="tax_rate"
                    type="number"
                    min="0"
                    max="100"
                    step="0.01"
                    defaultValue={(v.tax_rate || 0) * 100}
                  />
                </label>
              </div>
              <p className="field-help">
                Prices, availability, and limits are enforced by the transaction
                engine.
              </p>
            </>
          )}
          {kind === "agent" && (
            <>
              <label>
                Opening greeting
                <textarea name="greeting" defaultValue={v.greeting} rows={3} />
              </label>
              <div className="form-grid">
                <label>
                  Languages
                  <input
                    name="languages"
                    defaultValue={(v.languages || ["es-MX", "en-US"]).join(
                      ", ",
                    )}
                  />
                </label>
                <label>
                  Pickup estimate (minutes)
                  <input
                    name="pickup_minutes"
                    type="number"
                    min="1"
                    max="180"
                    defaultValue={v.pickup_minutes || 15}
                  />
                </label>
              </div>
              <label>
                Human handoff number
                <input
                  name="handoff_number"
                  type="tel"
                  defaultValue={v.handoff_number}
                  placeholder="+52…"
                />
              </label>
              <label>
                After hours
                <select
                  name="after_hours"
                  defaultValue={v.after_hours || "information_only"}
                >
                  <option value="information_only">
                    Answer information questions only
                  </option>
                  <option value="scheduled_orders">
                    Allow scheduled pickup orders
                  </option>
                </select>
              </label>
              <label>
                Special instructions
                <textarea
                  name="instructions"
                  rows={4}
                  defaultValue={v.instructions}
                />
              </label>
            </>
          )}
          {kind === "phone" && (
            <>
              <label>
                Phone setup
                <select name="mode" defaultValue={v.mode || "forwarding"}>
                  <option value="forwarding">Forward my existing number</option>
                  <option value="new_number">Use a new AI number</option>
                </select>
              </label>
              <label>
                Ordering phone
                <input
                  name="ordering_phone"
                  type="tel"
                  defaultValue={v.ordering_phone}
                  placeholder="+5255…"
                />
              </label>
              <p className="field-help">
                The number customers call. Configure forwarding to your
                ElevenLabs/Twilio ordering line.
              </p>
              <label>
                Team notification phone
                <input
                  name="notification_phone"
                  type="tel"
                  defaultValue={v.notification_phone}
                  placeholder="+5255…"
                />
              </label>
              <div className="info-banner">
                <Phone size={17} />
                <p>
                  Saving a number does not purchase or provision it. Connect it
                  in Twilio and ElevenLabs first.
                </p>
              </div>
            </>
          )}
          {kind === "model" && (
            <>
              <div className="form-grid">
                <label>
                  Provider
                  <select
                    name="provider"
                    defaultValue={v.provider || "deepseek"}
                  >
                    {[
                      "deepseek",
                      "qwen",
                      "ollama",
                      "vllm",
                      "sglang",
                      "generic",
                    ].map((x) => (
                      <option key={x} value={x}>
                        {label(x)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Hosting
                  <select name="hosting" defaultValue={v.hosting || "hosted"}>
                    <option value="hosted">Hosted</option>
                    <option value="self-hosted">Self hosted</option>
                  </select>
                </label>
              </div>
              <label>
                Endpoint URL
                <input
                  type="url"
                  name="endpoint"
                  defaultValue={v.endpoint || "https://api.deepseek.com/v1"}
                  required
                />
              </label>
              <label>
                Model ID
                <input
                  name="model"
                  defaultValue={v.model || "deepseek-flash"}
                  required
                />
              </label>
              <label>
                API key
                <input
                  name="api_key"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    v.has_api_key
                      ? "Saved securely · leave blank to keep"
                      : "Paste your provider API key"
                  }
                />
              </label>
              <label>
                Timeout (milliseconds)
                <input
                  name="timeout_ms"
                  type="number"
                  min="1000"
                  max="30000"
                  defaultValue={v.timeout_ms || 10000}
                />
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="fallback_enabled"
                  defaultChecked={v.fallback_enabled}
                />
                Allow external DeepSeek fallback
              </label>
              <div className="info-banner">
                <LockKeyhole size={17} />
                <p>
                  Saved keys are never returned to your browser. Run
                  compatibility tests before using a model for live orders.
                </p>
              </div>
            </>
          )}
          {kind === "pos" && (
            <>
              <label>
                Order destination
                <select
                  name="provider"
                  defaultValue={v.provider || "dashboard"}
                >
                  <option value="dashboard">Dashboard only</option>
                  <option value="square">Square</option>
                  <option value="webhook">Custom webhook</option>
                </select>
              </label>
              <label>
                Webhook URL
                <input
                  name="endpoint"
                  type="url"
                  defaultValue={v.endpoint}
                  placeholder="https://your-system.example/orders"
                />
              </label>
              <label>
                Authorization token
                <input
                  name="token"
                  type="password"
                  autoComplete="new-password"
                  placeholder={
                    v.has_token
                      ? "Saved · leave blank to keep"
                      : "Optional bearer token"
                  }
                />
              </label>
              <label>
                Square location ID
                <input
                  name="location_id"
                  defaultValue={v.location_id}
                  placeholder="Your Square location"
                />
              </label>
              <p className="field-help">
                Square credentials are configured on the server. Stable item and
                modifier mappings are required for POS delivery.
              </p>
              <details className="mapping-details">
                <summary>Square catalog mappings</summary>
                <p className="field-help">
                  Match each menu item and customization to its Square catalog
                  object ID.
                </p>
                <div className="mapping-fields">
                  {[
                    ...data.catalog.map((i) => ({ id: i.id, name: i.name })),
                    ...[
                      ...new Map(
                        data.catalog
                          .flatMap((i) => i.modifiers || [])
                          .map((m: Obj) => [m.id, m]),
                      ).values(),
                    ].map((m: Obj) => ({ id: m.id, name: m.name })),
                  ].map((i) => (
                    <label key={i.id}>
                      {i.name}
                      <input
                        name={"map__" + i.id}
                        defaultValue={v.catalog_mappings?.[i.id] || ""}
                        placeholder="Square catalog object ID"
                      />
                    </label>
                  ))}
                </div>
              </details>
              <div className="pos-capabilities">
                <span>
                  <Check size={12} />
                  Create orders
                </span>
                <span>Catalog mapping: manual</span>
                <span>Order updates: unavailable</span>
              </div>
            </>
          )}
          {kind === "notifications" && (
            <>
              <label>
                Manager notification phone
                <input
                  name="manager_phone"
                  defaultValue={v.manager_phone}
                  placeholder="+5255…"
                  type="tel"
                />
              </label>
              <p className="field-help">
                Connect Twilio WhatsApp on the server to deliver order summaries
                and payment links.
              </p>
            </>
          )}
          {(kind === "payments" || kind === "stripe") && (
            <>
              <div className="integration-detail-logo stripe-word">stripe</div>
              <Badge value="TEST_MODE" />
              <p>
                Ring Orden creates hosted Stripe Checkout sessions for confirmed
                orders. Verified payment webhooks update your dashboard.
              </p>
              <div className="setup-vars">
                <span>Required server configuration</span>
                <code>STRIPE_SECRET_KEY=sk_test_…</code>
                <code>STRIPE_WEBHOOK_SECRET=whsec_…</code>
              </div>
              <p className="field-help">
                Webhook endpoint: <code>/api/webhooks/stripe</code>
              </p>
              <button
                className="secondary"
                type="button"
                disabled={testing}
                onClick={() => test("/integrations/stripe/test")}
              >
                {testing ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                Test Stripe connection
              </button>
            </>
          )}
          {kind === "team" && (
            <>
              <label>
                Full name
                <input name="name" required disabled={!!inviteUrl} />
              </label>
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  disabled={!!inviteUrl}
                />
              </label>
              <label>
                Role
                <select name="role" disabled={!!inviteUrl}>
                  <option value="MANAGER">Manager</option>
                  <option value="STAFF">Staff</option>
                </select>
              </label>
              <div className="info-banner">
                <Mail size={17} />
                <p>
                  The link must be accepted by someone signed in with this exact
                  email. Send the link to your teammate yourself.
                </p>
              </div>
              {inviteUrl && (
                <div className="invite-link">
                  <label>
                    Invitation link
                    <input readOnly value={inviteUrl} />
                  </label>
                  <button
                    type="button"
                    className="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(inviteUrl);
                        notify("Invitation link copied.");
                      } catch {
                        notify("Select the link above to copy it.");
                      }
                    }}
                  >
                    <Copy size={15} />
                    Copy invitation
                  </button>
                </div>
              )}
            </>
          )}
          {!known.includes(kind) && kind !== "stripe" && (
            <>
              <div
                className="integration-detail-logo"
                style={{ color: vendorColors[kind] || "#7b3444" }}
              >
                {integration?.name || label(kind)}
              </div>
              <p>
                {integration?.description ||
                  "Connect this provider through your server configuration."}
              </p>
              <div className="setup-vars">
                <span>Configure server environment variables</span>
                {(kind === "elevenlabs"
                  ? ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID"]
                  : kind === "twilio"
                    ? [
                        "TWILIO_ACCOUNT_SID",
                        "TWILIO_AUTH_TOKEN",
                        "TWILIO_WHATSAPP_FROM",
                      ]
                    : kind === "deepseek"
                      ? ["DEEPSEEK_API_KEY"]
                      : kind === "square"
                        ? ["SQUARE_ACCESS_TOKEN", "SQUARE_LOCATION_ID"]
                        : kind === "firecrawl"
                          ? ["FIRECRAWL_API_KEY"]
                          : kind === "mojoauth"
                            ? [
                                "MOJOAUTH_JWKS_URL",
                                "MOJOAUTH_ISSUER",
                                "MOJOAUTH_AUDIENCE",
                              ]
                            : kind === "supabase"
                              ? ["SUPABASE_URL", "SUPABASE_SERVER_SECRET"]
                              : kind === "n8n"
                                ? ["AGENT_TOOL_SECRET", "N8N_WEBHOOK_URL"]
                                : ["CUSTOM_WEBHOOK_URL"]
                ).map((x) => (
                  <code key={x}>{x}</code>
                ))}
              </div>
              <p className="field-help">
                See the project setup guide for provider-side steps and callback
                endpoints. Secrets belong on the server.
              </p>
              <button
                className="secondary"
                type="button"
                disabled={testing}
                onClick={() => test("/integrations/" + kind + "/test")}
              >
                {testing ? (
                  <Loader2 className="spin" size={16} />
                ) : (
                  <Play size={16} />
                )}
                Test connection
              </button>
              {kind === "elevenlabs" && (
                <button
                  className="secondary"
                  type="button"
                  disabled={testing}
                  onClick={() =>
                    test("/integrations/elevenlabs/configure-tools")
                  }
                >
                  {testing ? (
                    <Loader2 className="spin" size={16} />
                  ) : (
                    <Play size={16} />
                  )}
                  Connect ordering tools
                </button>
              )}
              {kind === "deepseek" && (
                <p className="field-help">
                  You can also save a model connection from the AI model page.
                </p>
              )}
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
          {known.includes(kind) && kind !== "payments" && !inviteUrl && (
            <button className="primary" disabled={saving}>
              {saving ? (
                <Loader2 className="spin" size={16} />
              ) : (
                <Check size={16} />
              )}
              {kind === "team" ? "Create invitation" : "Save settings"}
            </button>
          )}
        </div>
      </form>
    </Modal>
  );
}
const steps = [
  "Business",
  "Menu",
  "Phone",
  "Notifications",
  "AI model",
  "POS",
  "Payments",
  "Agent",
  "Test",
  "Go live",
];
export function Onboarding({
  data,
  action,
  notify,
  onClose,
  onTest,
}: {
  data: Workspace;
  action: Props["action"];
  notify: Props["notify"];
  onClose: () => void;
  onTest: () => void;
}) {
  const [step, setStep] = useState(0),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(data.merchant.name),
    [address, setAddress] = useState(data.merchant.address);
  const next = async () => {
    setBusy(true);
    if (step === 0) {
      const r = await action("/settings", "PATCH", {
        section: "business",
        values: { name, address },
      });
      if (!r) {
        setBusy(false);
        return;
      }
    }
    await action("/settings", "PATCH", {
      section: "onboarding",
      values: { step: step + 2, completed: false },
    });
    setStep(step + 1);
    setBusy(false);
  };
  const ready = data.integrations.filter((i) => i.configured);
  return (
    <Modal
      wide
      title="A new chapter for your counter."
      subtitle="Let’s make Ring Orden feel right at home."
      onClose={onClose}
    >
      <div className="onboarding-progress">
        {steps.map((s, i) => (
          <button
            key={s}
            className={i === step ? "current" : i < step ? "done" : ""}
            onClick={() => setStep(i)}
          >
            <span>{i < step ? <Check size={12} /> : i + 1}</span>
            {s}
          </button>
        ))}
      </div>
      <div className="onboarding-body">
        <div className="eyebrow">
          STEP {step + 1} OF {steps.length}
        </div>
        <h2>
          {
            [
              "First, a little about your business.",
              "Something delicious starts with your menu.",
              "The number your guests know.",
              "Keep guests and your team in the loop.",
              "Choose the brain behind your counter.",
              "Your existing workflow, connected.",
              "Make paying as easy as ordering.",
              "A little personality goes a long way.",
              "Let’s give it a ring.",
              "Ready for your next hello?",
            ][step]
          }
        </h2>
        {step === 0 ? (
          <div className="form">
            <label>
              Business name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </label>
            <label>
              Address
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
              />
            </label>
            <div className="onboard-facts">
              <span>Mexico City timezone</span>
              <span>MXN currency</span>
              <span>Spanish & English</span>
            </div>
          </div>
        ) : step === 1 ? (
          <>
            <p>
              Your workspace has {data.catalog.length} menu items ready to
              explore. Add prices, modifiers, and availability from the Menu
              page.
            </p>
            <div className="onboarding-menu">
              {data.catalog.slice(0, 4).map((i) => (
                <div key={i.id}>
                  <span>{i.name}</span>
                  <strong>{money(i.price)}</strong>
                  <CheckCircle2 size={16} />
                </div>
              ))}
            </div>
          </>
        ) : step === 2 ? (
          <>
            <p>
              Forward your existing restaurant number or configure a new Twilio
              line in ElevenLabs. Keep the number your regulars already know.
            </p>
            <div className="onboard-box">
              <Phone size={26} />
              <strong>
                {data.settings.phone?.ordering_phone || "Phone setup needed"}
              </strong>
              <span>Configure from Phone & agent.</span>
            </div>
          </>
        ) : step === 3 ? (
          <>
            <p>
              WhatsApp confirmations include the order summary, pickup details,
              and payment link. Connect your Twilio WhatsApp sender to activate
              delivery.
            </p>
            <div className="onboard-box">
              <MessageCircle size={26} />
              <strong>WhatsApp · SMS · Team alerts</strong>
              <span>Provider configuration required.</span>
            </div>
          </>
        ) : step === 4 ? (
          <>
            <p>
              Start with DeepSeek or bring an OpenAI-compatible model. Run the
              compatibility suite before taking your first live order.
            </p>
            <div className="onboard-box">
              <Zap size={26} />
              <strong>{data.settings.model?.model || "DeepSeek"}</strong>
              <span>
                {data.settings.model?.has_api_key
                  ? "API key saved"
                  : "Model credentials needed"}
              </span>
            </div>
          </>
        ) : step === 5 ? (
          <>
            <p>
              Send orders to Square, a custom webhook, or your Ring Orden
              dashboard. Your POS stays your POS.
            </p>
            <div className="onboard-box">
              <Plug size={26} />
              <strong>
                {label(data.settings.pos?.provider || "Dashboard only")}
              </strong>
              <span>Stable catalog mappings keep orders consistent.</span>
            </div>
          </>
        ) : step === 6 ? (
          <>
            <p>
              Stripe test mode is the place to start. Configure a test secret
              key and the signed webhook endpoint, then run a test payment.
            </p>
            <div className="onboard-box">
              <CreditCard size={26} />
              <strong>Stripe Checkout</strong>
              <span>No live charges in demo mode.</span>
            </div>
          </>
        ) : step === 7 ? (
          <>
            <p>
              Choose your greeting, languages, pickup time, and handoff rules in
              Phone & agent.
            </p>
            <blockquote>“{data.settings.agent?.greeting}”</blockquote>
          </>
        ) : step === 8 ? (
          <>
            <p>
              Try an order, change your mind, and make your agent ask a
              clarification. A test conversation uses the exact same transaction
              engine.
            </p>
            <button className="primary" onClick={onTest}>
              <Phone size={16} />
              Start test conversation
            </button>
          </>
        ) : (
          <>
            <p>
              {data.mode === "demo"
                ? "Your demo is ready. Connect and verify the services below before taking live calls."
                : "Review each connection before enabling live calls."}
            </p>
            <div className="readiness-list">
              {data.integrations.map((i) => (
                <div key={i.id}>
                  <span>{i.name}</span>
                  <Badge
                    value={i.configured ? "CONFIGURED" : "setup_required"}
                  />
                </div>
              ))}
            </div>
            <div className="info-banner">
              <ShieldCheck size={17} />
              <p>
                {ready.length} of {data.integrations.length} services
                configured. Live status requires successful provider tests.
              </p>
            </div>
          </>
        )}
      </div>
      <div className="modal-footer">
        <button
          className="secondary"
          onClick={() => (step > 0 ? setStep(step - 1) : onClose())}
        >
          <ArrowLeft size={15} />
          {step > 0 ? "Back" : "Do this later"}
        </button>
        {step < steps.length - 1 ? (
          <button
            className="primary"
            disabled={busy || (step === 0 && !name.trim())}
            onClick={next}
          >
            Continue <ArrowRight size={15} />
          </button>
        ) : (
          <button
            className="primary"
            disabled={busy}
            onClick={async () => {
              await action("/settings", "PATCH", {
                section: "onboarding",
                values: { step: 11, completed: true },
              });
              notify("Setup checklist saved. Your demo is ready to explore.");
              onClose();
            }}
          >
            Explore your workspace <ArrowRight size={15} />
          </button>
        )}
      </div>
    </Modal>
  );
}
