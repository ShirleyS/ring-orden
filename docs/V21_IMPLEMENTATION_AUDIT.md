# RingOrden V2.1 implementation audit

Audited 2026-10-28. This is an extension of existing implementation. User authorized completion under a one-hour deadline at 17:19 UTC. Implementation and deployment verification are separate milestones.

## 1. Existing functionality

- Canonical order schemas, deterministic prices/modifiers/availability, confirmation gates, request deduplication, optimistic concurrency and POS retries exist in core/API.
- Supabase live metadata confirms three applied migrations, private `ring_private.app_state` with one tenant, and normalized public order/menu tables with zero rows. Runtime order truth is the tenant JSON document, not those empty normalized tables. No customer/billing/invoice tables exist.
- Merchant authentication supports existing MojoAuth, Supabase and Sites paths; OWNER/MANAGER/STAFF authorization already exists. Preserve all paths.
- OpenPOS-equivalent adapters live in `packages/ring-orden-connect`; OpenCorrect correction evidence lives in `packages/ring-orden-memory`. Preserve both and keep preference memory separate.
- Direct ElevenLabs business/menu/order tools exist. BYO model gateway exists. Live agent configuration and actual telephone call remain unverified.
- Customer-links branch has secure order grants, exact-origin customer API, owner issue/revoke controls and a Lovable ES/EN demo. Its documented 346 local tests do not prove deployed integration. Grants currently last one hour; no ten-minute dropped-call workflow exists.
- Existing Stripe signed webhooks validate transactions before emitting verified payment events. Backend currently sends WhatsApp directly.
- n8n D accepted a synthetic payment event (execution 14). D enriches events; it does not send WhatsApp. Backend authenticated health most recently failed 401; public unauthenticated health succeeds. Other n8n wrappers remain drafts. Do not equate configured status with connectivity.

## 2. Missing functionality

Merchant-scoped customer identities/contact normalization; verification separate from caller recognition; explicit/inferred preference records and audit history; authorized previous-order/reorder tools; saved billing profiles/invoice requests; customer management UI; durable notification queue; receipt/fiscal grants; consent-aware WhatsApp automation; exact ten-minute recovery; Spanish-first ES/EN/ZH policy and live tests.

## 3. Duplicated functionality

A/B/G n8n wrappers duplicate direct voice-to-backend calls. C is transaction correction retrieval, not customer preference memory. Additional numbered cloud workflows have not had node-level review; preserve inactive until audited. Do not introduce a second conversational engine or duplicate canonical order tables. Lovable customer UI and React merchant dashboard already serve distinct audiences; retain both during this increment.

## 4. Required database changes

Incrementally add customers, contacts, preferences, memory events, billing profiles, invoice requests, verification records and an automation outbox. Preserve existing JSON order authority until a separate tested normalized cutover exists. New relational order references cannot falsely point to currently empty public.orders: use tenant-checked references to canonical runtime order IDs initially, then add physical FKs during cutover. Add tenant FKs/composite keys, tenant/contact lookup indexes, private grants/RLS, bounded RPCs, retention fields and role checks. Never expose billing data through generic state/bootstrap. Test SQL and application isolation before applying live migrations.

## 5. Required ElevenLabs changes

Direct authenticated customer context/preferences/update/history/reorder/billing-status/invoice/verification tools. Use server-bound tenant and session; never accept a caller's verification boolean. Minimal context and no fiscal values for unverified caller. Saved preference changes require explicit confirmation. Reorder creates a draft and revalidates current catalog/prices; final submission remains separate. Initial context may fail open to normal ordering. Greet in Mexican Spanish and permit only English/Chinese switching for this demo. Live configuration and fresh-call tests remain required.

## 6. Required n8n changes

| Workflow | Classification | Action |
| --- | --- | --- |
| A Process Turn | MIGRATE | Prefer direct ElevenLabs API; retain wrapper for rollback |
| B Confirm Order | MIGRATE | Same; backend keeps confirmation authority |
| C Correction Memory | MODIFY | Optional scoped OpenCorrect evidence; never customer store |
| D Verified Payment | KEEP / MODIFY | Preserve tested receiver; add asynchronous notification dispatch |
| E POS Retry | KEEP | Publish only after authenticated backend check passes |
| F Escalation | MODIFY | Backend ticket plus asynchronous staff notification; no claimed live transfer |
| G Onboarding | MIGRATE | Direct session initialization; retain stable request IDs |
| H Model Health | KEEP | Scheduled health automation once credentials verified |
| Numbered cloud workflows | UNVERIFIED | Node-level audit required before KEEP/MODIFY/MIGRATE/REMOVE decisions |

Add claim/ack/retry notification workflow using backend durable outbox. No customer database in n8n. Never claim sent/delivered without provider evidence. Do not remove working flows. Correct API-project bearer mismatch; no bearer prefix in Netlify secret. Leave one-minute schedule inactive until tested.

## 7. Required Lovable/dashboard changes

Preserve current UI. Add Customers with explicit/inferred labels, history, corrections, language and billing status. Owner-only fiscal management. Extend existing customer capability forms for receipts/fiscal collection and ten-minute recovery; do not require merchant login. Existing Lovable deployed API connection remains unverified. User requested merchant Lovable UI, while current implementation uses React merchant dashboard and Lovable customer pages: expose new management in existing merchant UI first and retain this discrepancy explicitly.

## 8. Required API changes

Add typed authenticated customer tools and owner customer endpoints; narrowly scoped customer verification grants; billing/invoice state machine; durable asynchronous job APIs with claims and idempotency; receipt/fiscal/recovery capability scopes. Extend public ingress only with exact paths/methods. Preserve MojoAuth, provider signatures, order guards, POS and correction logic. Redact billing from bootstrap, logs, tools and generic caches.

## 9. Security risks

- Caller ID is unverified; never return protected history/fiscal records solely from a phone match.
- Service credential binds one merchant; arbitrary caller tenant IDs must remain ignored/rejected.
- Private JSON state is loaded wholesale today; minimize voice responses and keep new fiscal data out of generic responses.
- Payment notification delivery currently lacks a durable outbox; a failed notification after deduplication can be lost.
- One-hour customer edit grants do not meet the requested ten-minute recovery requirement.
- Credentials were saved on different Netlify projects; latest authenticated check failed. Do not read/unmask secrets to diagnose.
- No configured/verified PAC invoice provider has been established; invoice requests must remain pending and never claim CFDI issuance.
- Customer retention/deletion and consent workflows need tests; no claims of production compliance.

## 10. Recommended order and verification

1. Preserve current branches; implement in isolated integration branch based on customer-links work.
2. Customer storage/context/preferences/history with tenant/verification tests.
3. Billing request storage and protected management; provider issuance stays unavailable until configured.
4. Customer UI and direct voice tool contracts; Spanish-first ES/EN/ZH policy.
5. Integrate existing links with ten-minute recovery and durable notification workflow contracts.
6. Run full suite/typecheck/build; review authorization and leakage.
7. Apply tested migrations/deploy; configure actual ElevenLabs/n8n/Lovable settings and verify real test-account journey if access permits.

Acceptance: persistence across fresh sessions; explicit preference survives; inference never overwrites explicit; repriced draft reorder requires confirmation; unverified fiscal/history access denied; other merchant denied; expired recovery denied; provider failures honest. Report local tests, hosted tests and actual calls separately. This audit does not claim V2.1 implemented.
