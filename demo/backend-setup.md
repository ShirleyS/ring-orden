# Backend configuration

Supabase is the selected production database; local development can retain persistent D1. Set both `SUPABASE_URL` and `SUPABASE_SERVER_SECRET` after applying all Supabase migrations to select the Supabase/PostgREST repository. See [deployment and guarded D1 import](../docs/SUPABASE.md). Bootstrap and health report the active storage provider. Both repositories enforce persistent authenticated merchant memberships, OWNER/MANAGER/STAFF route permissions, single-use email-bound team invitations and optimistic compare-and-swap writes.

## Local run

From the repository root install dependencies, run `npm run build`, then apply `drizzle/0000_typical_daredevil.sql` once:

```sh
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_typical_daredevil.sql
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0001_chemical_hairball.sql
npm run dev
```

Only loopback requests can use the explicit development identity. `oai-authenticated-*` headers are trusted by default only on `*.chatgpt.site`. On standalone API hosts they are ignored unless `TRUST_SITES_HEADERS=true` is explicitly configured behind a trusted proxy that strips client-supplied identity headers. Keep the flag false/unset on a directly reachable standalone server; merchant routes then require MojoAuth. Provider-signed webhooks and service-authenticated agent tools keep their own authentication. Hosted workspaces require the Sites authenticated identity or a verified MojoAuth session. Mutations reject foreign browser origins. Customer phone/name are excluded from new correction memory extraction.

Copy `.env.example` to `.dev.vars` for local Worker variables. Configure hosted variables through Sites runtime settings; do not put secrets in `.openai/hosting.json` or `NEXT_PUBLIC_*` variables. The app uses `DEMO_MODE=true` by default, with a deterministic labeled interpreter. With `DEMO_MODE=false`, calls require a real model and payments cannot be simulated.

## MojoAuth

Use your MojoAuth project's OIDC discovery metadata to set `MOJOAUTH_JWKS_URL`, `MOJOAUTH_ISSUER`, `MOJOAUTH_AUDIENCE`; generate `SESSION_SECRET` of at least 32 random characters. After the MojoAuth client flow yields an access token, `POST /api/auth/session {"access_token":"..."}` verifies RS256 signature, issuer, audience, subject, expiry and not-before against JWKS, then issues a secure HttpOnly session cookie. No default JWKS URL is invented. Sites identity remains the private hosted demo's access boundary.

## AI model

Set `DEEPSEEK_API_KEY` or save BYO credentials through the AI Model page. Keys never return in bootstrap or settings reads. The current default is `deepseek-flash`; model IDs are configurable. The gateway validates JSON/schema and catalog operations, retries invalid output once, and only uses the configured external fallback when the merchant enables it. Click Test Model for the actual ten-case compatibility run. No provider has a fabricated compatibility score.

## Voice

Set `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID`; use `/api/voice/signed-url` for a temporary WebSocket URL. Import tool contracts in `prompts/`. Tool calls use `POST /api/tools/<tool>` with `Authorization: Bearer <AGENT_TOOL_SECRET>`. Bind `AGENT_MERCHANT_ID` to the merchant from authenticated bootstrap. `create_session` returns a stable `session_id`; each turn supplies it plus `utterance` and `request_id`. Never derive the merchant from caller speech. Human handoff creates a callback ticket; live Twilio transfers require telephony provider setup.

Use ElevenLabs' documented Twilio integration for phone routing and forwarding. Ring Orden never purchases a number automatically. Ordering and notification phone numbers are separate fields.

## Stripe and WhatsApp

Set a Stripe **test** secret/restricted key and webhook signing secret. Register `/api/webhooks/stripe` for `checkout.session.completed` and `checkout.session.async_payment_succeeded`. The raw payload is signed and checked; only a matching saved checkout, authoritative amount, currency and paid status can update an order. Success-page query parameters cannot mark paid. Simulated payment requires demo mode and an order with source `demo`. Paid cancellations become REFUND_PENDING; no refund is claimed until an implementation receives provider confirmation.

Set Twilio SID/token, approved WhatsApp sender and a template SID for business-initiated messages outside the 24-hour session window. A sandbox requires each test recipient to opt in. Checkout and notification failures preserve the order and appear in the audit log. Confirmed orders persist before provider delivery, and a compare-and-swap claim protects the delivery outbox. Stripe and Square use stable idempotency keys. A crashed PROCESSING delivery requires operator reconciliation before retrying WhatsApp, whose API does not provide the same idempotency contract.

A private Site rejects identity-less callbacks at the hosting gate. Deploy the API behind a public ingress with the supplied provider/service authentication for external callbacks, or use a dedicated backend host. Keep merchant routes private. Do not expose a bypass bearer token in client code.

## POS

Square defaults to sandbox. Configure token/location plus `settings.pos.catalog_mappings` from canonical catalog/modifier IDs to Square catalog-object IDs. Square create uses the Orders API, canonical prices and stable idempotency. It is implemented and contract-tested, but account compatibility and kitchen-ticket routing require a real sandbox test. Other providers explicitly report unsupported order-write capabilities. Custom webhook sends canonical orders with timestamped HMAC and Idempotency-Key. Failed submissions retain the order and support safe manual or n8n retry.

## Supabase

Apply both CLI-created migrations in order: `database/supabase/migrations/20261027225425_ring_orden.sql` and `20261027230839_ring_orden_runtime.sql`. The first defines the normalized schema, composite tenant foreign keys, role RLS, private credentials and Realtime publication. The second adds the running private JSON-state repository and PostgREST RPCs. The backend uses the same Repository contract on D1 and Supabase.

Set `SUPABASE_URL` and server-only `SUPABASE_SERVER_SECRET` (new `sb_secret_*` or legacy service-role key). No browser receives that key. Private runtime state/invitation/event tables have RLS and no authenticated/anonymous grants; runtime RPC execution is granted only to `service_role`. Scoped RPCs verify merchant ownership or persisted membership against the authenticated subject supplied by the verified backend, and updates compare the expected revision. Trusted payment/tool operations use separate service-only RPCs after provider/service authentication. Neither a browser-selected merchant ID nor user-editable metadata can grant access.

The optional repository has injected-HTTP contract tests; the SQL has not been applied to a real Supabase project in this build. Apply the migrations, run Supabase advisors and cross-tenant queries on the actual project before live operation. Active JSON-state records use dashboard polling; normalized-table Realtime is available for an expanded normalized deployment. Supplying only one Supabase variable fails explicitly rather than silently changing stores.

## Team permissions

An OWNER can `POST /api/team` to create a 24-hour single-use invitation bound to the exact normalized recipient email. The response includes `invite_url`; copy it to the recipient yourself. No email is sent automatically. The URL uses `/?invite=<random-token>`. The recipient signs in and `POST /api/team/accept {token}` verifies the authenticated email, consumes the hashed token atomically, persists membership, and sets an active-workspace cookie. Workspace selection is always checked against membership. Old pending demonstration records do not confer access.

STAFF sees active orders and basic call state, can move paid orders through preparing/ready/completed, and cannot read transcripts, customer phone numbers, configuration, memory, integrations or team. MANAGER can manage orders, availability, correction approvals and escalations; price/model/payment/settings/team management stays with OWNER. Endpoint guards and bootstrap/direct-read redaction enforce the role on the server.

## Automatic POS retry

After a failed delivery, metadata persists attempt count and an exponential next retry time (30 seconds, then 60 seconds, capped at 5 minutes). Workflow E contains an inactive-on-import one-minute Schedule Trigger. After credentials are configured and that workflow is published, it calls the authenticated `retry_failed_pos` service tool. The backend claims due orders using CAS, skips concurrent claims, reuses stable provider idempotency keys, caps attempts at the merchant limit (default 3), and creates an escalation when the limit is reached. A stale two-minute lease can recover safely. This schedule was authored and contract-tested, not activated on a live n8n account.


## API contracts

`GET /api/bootstrap` returns the authenticated merchant, menu, orders, calls, memory, settings (redacted), integration readiness, team and derived stats. All writes infer merchant from authentication. `/api/sessions`, `/api/sessions/:id/turn`, `/api/orders/:id/action`, `/api/menu`, `/api/memories`, `/api/settings`, `/api/models/test`, `/api/integrations/:id/test`, `/api/escalations/:id/resolve` are implemented. Supply `Idempotency-Key` or `request_id` for retried writes. A repeated ID with different input returns 409. Concurrent edits use a persisted revision compare-and-swap to prevent lost updates.

Order operations and prices are schema-validated in Core. No generic client status/price overwrite exists. Transcripts and audit events contain structured operations, provider/model and result metadata, never chain-of-thought. Dashboard polling is the active realtime fallback.

Official provider references verified during implementation: [MojoAuth tokens](https://mojoauth.com/docs/authentication/handle-jwt-token/), [ElevenLabs signed URLs](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get-signed-url), [Twilio WhatsApp messages](https://www.twilio.com/docs/messaging/api/message-resource), [Stripe Checkout](https://docs.stripe.com/api/checkout/sessions/create), [Stripe webhooks](https://docs.stripe.com/webhooks), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
