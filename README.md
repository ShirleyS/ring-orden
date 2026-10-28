# Ring Orden

**Turn a messy conversation into a reliable order.**

Ring Orden is a voice-commerce MVP for restaurant phone ordering, with a merchant workspace and four reusable MIT-licensed infrastructure packages. Models propose constrained operations; application code validates the catalog, applies changes, calculates prices, and controls confirmation and fulfillment.

The runnable demo includes a café workspace, sample orders, a conversation simulator, order management, correction-memory controls, menu availability and CSV import, business hours, team invitations, integration settings, onboarding, and audit activity. Demo interactions are labeled. External providers require configuration; simulated events must not be presented as real calls, delivered messages, POS tickets, or payments.

## Quick start

Requires Node.js **22.13 or later** and npm. Node 26 is used for the native TypeScript test suite.

~~~sh
npm ci
npm run db:generate
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_typical_daredevil.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_chemical_hairball.sql
npm run dev
~~~

Open the local URL printed by the development server, normally http://localhost:5173. These commands initialize only local D1, including persistent memberships and invitations. Do not replay migrations already applied. The committed migrations already exist, so db:generate should report no schema changes. Apply later pending migrations in order using their actual filenames.

The loopback demo needs no external credentials. It uses an explicit development merchant and seeds sample data once per merchant. Hosted requests require a signed-in identity. Secrets belong in local .dev.vars or the hosting environment, never in browser code or committed files. Consult [.env.example](.env.example) for server variables. Local environment files do not configure the hosted deployment.

~~~sh
npm test
npm run typecheck
npm run build
~~~

Tests exercise deterministic transaction logic, tenant boundaries, memory isolation, model-output validation, POS payloads and payment verification with controlled external responses. Provider contract tests do not prove that a real account is connected.

## What runs where

| Area | Running implementation | Setup or boundary |
| --- | --- | --- |
| Merchant UI | React on Vinext, responsive merchant workspace | Source can be adapted to Lovable. The Lovable hosted authoring service was not used to create this checkout. |
| Local demo persistence | Cloudflare D1, tenant-scoped state, memberships and revision checks | Local D1 remains available for credential-free development. Local and hosted databases are separate. |
| Production database | Supabase Postgres through scoped, server-only RPCs; normalized RLS schema also included | Apply all migrations, then configure SUPABASE_URL and SUPABASE_SERVER_SECRET together. A one-time importer preserves the existing private Site's D1 workspace. See [Supabase setup](docs/SUPABASE.md) for activation and verification. |
| Merchant identity | Private Sites identity; loopback demo identity | MojoAuth token-verification/session boundary is provided. Configure the actual application and passwordless frontend flow. |
| Intelligence | Deterministic demonstration interpreter | Configure credentials to run actual model interpretation and compatibility tests. |
| Voice | Browser audio session through the ElevenLabs SDK, signed URLs and backend agent tools | Configure agent credentials and tools. Phone routing is separate. The real microphone/provider session has not been tested with credentials. |
| Payments | Demo-payment simulation; Stripe test checkout and signed webhooks | Demo payment is not Stripe payment. Real test checkout needs credentials and a reachable webhook. |
| POS | Dashboard delivery; Square and signed custom-webhook implementations | Square needs sandbox credentials and stable external item/modifier mappings. Unsupported manifests are not verified integrations. |
| Notifications | Settings, delivery state and Twilio WhatsApp implementation | Requires a sender, a valid recipient, consent and an approved template when the messaging window requires it. |
| Workflows | Eight n8n imports, including a one-minute scheduled POS retry workflow | Import, configure URLs and credentials, activate and test. The scheduler is inactive until published in n8n. |

The default café catalog uses **MXN**. Prices use integer minor units internally and decimal peso display. Default limits are 50 total units, 20 units per individual add operation, and MXN 5,000. Merchant tax, minimum-order and maximum-order rules pass through the authoritative backend.

## Source layout

~~~text
app/                         React merchant app and API entrypoint
apps/api/src/                Auth, repository, agent tools and commerce API
packages/ring-orden-core/    Schemas, operations, pricing and state machine
packages/ring-orden-memory/  Detection, extraction, ranking and isolated retrieval
packages/openmodel-gateway/ Model adapters, demo interpreter and compatibility
packages/ring-orden-connect/ POS interface, Square and custom webhooks
db/                         Running D1/Drizzle schema
drizzle/                    Committed D1 migrations
database/supabase/           Supabase RLS schema, runtime RPCs and cutover migrations
prompts/                    Transaction/voice prompts and tool contracts
n8n/                        Importable orchestration workflows
demo/DEMO.md                Reproducible demo script and expected results
docs/OPEN_SOURCE.md          Public code and private merchant data boundaries
~~~

## Configure external services

Begin with the credential-free demo. Configure one provider at a time, run its test, then run a complete order through that path. Keep DEMO_MODE=true while rehearsing. Set DEMO_MODE=false only after required services have been configured and verified.

| Service | Human/account setup | Server variables or settings |
| --- | --- | --- |
| DeepSeek | Obtain an API key; verify the selected model ID against available account models | DEEPSEEK_API_KEY; AI Model settings select endpoint, model, timeout and fallback |
| Other model | Host or obtain an HTTPS OpenAI-compatible endpoint; run compatibility cases | AI Model provider, endpoint, model and server-stored API key; external fallback defaults off |
| ElevenLabs | Create an agent, attach provided tools and configure languages | ELEVENLABS_API_KEY, ELEVENLABS_AGENT_ID, AGENT_TOOL_SECRET, AGENT_MERCHANT_ID |
| Twilio | Configure number/forwarding and the voice-agent connection; activate a WhatsApp sender or sandbox recipient | TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM, optional TWILIO_WHATSAPP_TEMPLATE_SID |
| Stripe | Use a test-mode key; register /api/webhooks/stripe for completed and asynchronous-success checkout events | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET |
| Square | Create a sandbox location and catalog; map products and modifiers to stable Square IDs | SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENVIRONMENT; POS catalog mappings |
| Custom webhook | Provide an HTTPS canonical-order receiver that deduplicates the supplied key | POS endpoint and signing secret; receiver verifies timestamp and signature |
| MojoAuth | Configure actual issuer, audience and signing keys; connect passwordless sign-in | MOJOAUTH_JWKS_URL, MOJOAUTH_ISSUER, MOJOAUTH_AUDIENCE, SESSION_SECRET of at least 32 random characters |
| n8n | Import workflows; configure app origin/tool secret and provider credentials; activate | N8N_WEBHOOK_URL, N8N_WEBHOOK_SECRET, workflow-specific configuration |
| Supabase | Apply all SQL migrations in order; keep the server key private | SUPABASE_URL and SUPABASE_SERVER_SECRET select Supabase; SUPABASE_MIGRATE_D1=true performs the guarded one-time private Site import |

Ordering phone and notification phone are separate fields. Saving a phone string does not purchase, port or activate a number. Ring Orden does not provision paid services automatically.

Stripe marks PAID only after a valid, timely signature, a matching saved Checkout Session, matching merchant/order metadata, matching amount/currency and payment_status=paid. A success-page redirect does not mark an order paid. Demo-payment actions are limited to demo orders and logged as simulation.

## Supabase runtime

Apply [the normalized schema](database/supabase/migrations/20261027225425_ring_orden.sql), [the runtime migration](database/supabase/migrations/20261027230839_ring_orden_runtime.sql), and [the cutover migration](database/supabase/migrations/20261028000753_ring_orden_cutover.sql), in that order. Set SUPABASE_URL and SUPABASE_SERVER_SECRET together in the server environment and restart or redeploy. Supplying only one fails closed. Use a server secret or service-role key; never return it to the browser. SUPABASE_PUBLISHABLE_KEY is available for future direct-client features and is not used by this repository. See [Supabase deployment and data preservation](docs/SUPABASE.md).

The normalized schema supplies merchant-scoped tables and RLS. The current SupabaseRepository persists the working application's tenant state as JSON in the private ring_private.app_state table, with revision checks, separate invitation/event tables and scoped RPCs. Browser anonymous/authenticated roles cannot execute those runtime functions. Verified identity, role checks and service-only RPC calls remain on the backend. The live application does not populate every normalized order/menu/memory table; moving those records into normalized tables is a separate storage refactor. JSON-state persistence keeps parity with D1, with whole-tenant contention and growth tradeoffs. Database migrations and SQL access controls are verified separately from deployed runtime credential activation. No realtime subscription is implemented.

## Team, hours and delivery

Owners create email-bound, single-use invitation links from Team. Share the link manually with the intended teammate. It expires after 24 hours and must be accepted by a signed-in user with the matching verified email. Persistent memberships enforce OWNER, MANAGER and STAFF API permissions; staff receive active-order/basic-call data with sensitive fields removed. Email invitations are not sent automatically.

Set weekly opening hours and special closures in Settings. Live ordering enforces the business timezone, overnight hours and closures. Scheduled ordering requires a future pickup inside an opening interval. Demo mode deliberately permits rehearsal outside business hours. Confirmed but unpaid orders can be edited before unsupported downstream POS changes: the old Stripe Checkout Session is expired and the revised order must be confirmed again. Orders already sent to an adapter without update support require the team to approve changes.

Confirmation and a delivery claim are persisted before external side effects. POS failures keep the order and record retry metadata. Import and activate workflow E to check due failures every minute; the backend uses claimed retries, backoff, stable provider keys and a default limit of three total attempts. After the limit, the merchant receives an escalation ticket in the workspace. Read [n8n setup](n8n/README.md) for credential and ingress requirements.

The initial private Site requires interactive sign-in. External Stripe, ElevenLabs and n8n callbacks therefore need a separately deployed reachable API ingress protected by the supplied provider signatures and service token. Keep the merchant workspace private. The current agent integration uses a server-configured AGENT_MERCHANT_ID; use a separate binding/deployment per merchant until a phone-number-to-tenant registry is added.

## API overview

Authenticated routes derive the merchant from verified identity. Agent tools use a separate bearer secret and server-configured merchant binding.

| Route | Purpose |
| --- | --- |
| GET /api/bootstrap | Tenant merchant, catalog, orders, memory, settings and dashboard data |
| POST /api/sessions | Start persisted test conversation |
| POST /api/sessions/:id/turn | Interpret and apply an utterance |
| GET /api/orders/:id | Read tenant-owned order |
| POST /api/orders/:id/action | Confirm, fulfill, retry, cancel or simulate demo payment |
| PATCH /api/menu/:id | Edit catalog and availability |
| PATCH /api/memories/:id | Approve, edit, disable or enable mapping |
| DELETE /api/memories/:id | Delete mapping |
| PATCH /api/settings | Save configuration; secret values omitted from responses |
| POST /api/models/test | Run configured model compatibility cases |
| POST /api/tools/:tool | Authenticated conversational-agent tools |
| POST /api/team | Create an owner-authorized, email-bound invitation link |
| POST /api/team/accept | Accept the link as its intended verified-email recipient |
| POST /api/webhooks/stripe | Verify and process payment events |

Send an Idempotency-Key on repeat mutation attempts. A key reused with different input is rejected. Reuse server-created session IDs for reconnecting callers. Do not accept a merchant ID from a caller.

## Scope and verification limits

The UI does not prove a live external integration. Telephony, model accuracy/latency, Square delivery, WhatsApp, MojoAuth and Stripe require credentialed end-to-end verification on the deployment.

Human handoff creates a callback/escalation ticket rather than guaranteeing live telephone transfer. Paid cancellation enters REFUND_PENDING; actual refund execution is not automated and must not be described as complete without provider confirmation. SMS and email senders are not implemented; WhatsApp is the supported notification adapter. Number purchasing/activation and a production transcript-retention job are not automated.

The dashboard uses eight-second polling rather than claiming an active Supabase Realtime subscription. Provider and model failures remain visible in the audit/diagnostic views. Validate the full external flow after configuring accounts; imported n8n workflows, real audio, provider delivery and the optional Supabase repository have not been exercised against live account credentials. Model and memory benchmark figures must come from actual runs; no figures are fabricated here.

See [the demo guide](demo/DEMO.md) and [open-source boundaries](docs/OPEN_SOURCE.md).

## Netlify deployment

See [Netlify deployment](docs/NETLIFY.md) for the dedicated build and verified private-project identity, and [Supabase](docs/SUPABASE.md) for the production database. The original Sites build remains supported.

## License and publication

Authored code uses the [MIT license](LICENSE). Vendored templates and dependencies retain their own licenses. A hosting source push may be private; the MIT license alone does not change repository visibility or publish an npm package. Public release requires a verified repository URL and reviewed source excluding credentials, runtime state and private merchant data.

## Homepage and demo showcase

The [bilingual homepage and interactive n8n showcase](showcase/README.md) runs without a build. Serve `showcase/` locally or open its `index.html` directly. Login links open the existing merchant app. The diagrams distinguish backend support from integrations that still need live verification.
