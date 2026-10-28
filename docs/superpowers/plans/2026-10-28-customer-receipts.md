# Customer receipts implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a secure Lovable receipt and order-specific RFC capture, with opted-in WhatsApp delivery and owner access.

**Architecture:** Extend the existing API and tenant repository (Supabase in configured deployments). Independent receipt capabilities reuse the customer handler's CORS/auth infrastructure, with no order-edit permissions. Lovable is the customer UI and the existing React dashboard supplies owner controls.

**Tech Stack:** TypeScript, Zod, React, Node tests, current Supabase repository, Twilio WhatsApp, Lovable.

**Spec:** `docs/superpowers/specs/2026-10-28-customer-receipts-design.md`

## Global Constraints
- Editing links expire after one hour; independent receipt links after seven days.
- Billing details stay in RingOrden's repository and are OWNER-only; customer reads return a masked summary.
- Format checks do not claim SAT validation or issuance of CFDI.
- No actual customer messages, new services, live payments, or purchased credits in development.
- Preserve unrelated original-checkout voice/public-ingress changes; extend existing draft PR.
- No raw capabilities in logs, persistent browser storage, generic request caches, or payment metadata.

## Review Focus
- Concurrent provider writes must not restore revoked links or overwrite newly submitted billing details (Task 2 regression).
- Capability scopes must reject cross-purpose order editing/confirmation and cross-tenant access (Task 1 tests).
- Duplicate confirmation and ambiguous provider failure must not resend automatically (Task 2 tests).
- Billing details must not leak through bootstrap, list, manager/staff, or events (Task 1 tests).
- A missing API or depleted Lovable credits must not produce a fake working integration (Task 3 manual checks and report).

### Task 1: Receipt capabilities and protected billing
**Files:** modify `apps/api/src/customer-orders.ts`, `types.ts`, `server.ts`, `rbac.ts`; create `apps/api/src/customer-receipts.ts` and `apps/api/tests/customer-receipts.test.ts`.
**Interfaces:** `issueCustomerReceiptLink(state, order, env) -> {url,expires_at}`; `revokeCustomerReceiptLink(state,orderId)`; `GET /api/customer/receipt` -> safe order view plus `{billing:{status,revision,rfc_masked}}`; `PUT /api/customer/billing` body `{revision,details:{rfc,legal_name,postal_code,tax_regime,cfdi_use,email?}}` -> same masked acknowledgement; owner `GET /api/orders/:id/billing`; `POST|DELETE /api/orders/:id/receipt-link`.
- [ ] Write tests for seven-day issuance, independent revoke, expiry, scope/tenant rejection, paid/unpaid state, validation, billing CAS, owner-only retrieval and no leaks.
- [ ] Run `node --experimental-strip-types --test apps/api/tests/customer-receipts.test.ts`; expect failures for missing routes.
- [ ] Implement independent receipt token envelope scope and hash storage; receipt GET and billing PUT with no full-profile readback, metadata redaction, owner routes and cache exclusions.
- [ ] Run receipt and existing customer tests; expect all pass. Commit Task 1.

### Task 2: Consent-aware receipt delivery and concurrency
**Files:** modify `apps/api/src/customer-orders.ts`, `customer-receipts.ts`, `server.ts`, `payments.ts`, `pos-retry.ts`, `auth.ts`, `.env.example`; extend receipt tests and provider tests.
**Interfaces:** customer confirm optionally accepts `whatsapp_receipt:boolean`; bound `tools/confirm_order` optionally accepts same; `POST /api/orders/:id/receipt-send` body `{customer_opted_in:true}` -> notification status; dedicated `sendReceiptWhatsApp(order,url,env)`; durable receipt-notification claim independent of POS/payment fulfillment.
- [ ] Write tests for no consent/no send, confirmed-only send, template contract, configured and demo behavior, duplicate confirm, failure/unknown, explicit resend and concurrent revoke/billing protection.
- [ ] Run targeted tests; expect missing notification behavior to fail.
- [ ] Implement consent recording at explicit confirm, independent durable send claim before external call, provider acknowledgement status, no automatic ambiguous retries, owner resend, and metadata merges preserving current receipt/billing fields.
- [ ] Run targeted tests and full API suite; expect all pass. Commit Task 2.

### Task 3: Merchant controls and Lovable UI
**Files:** create `apps/merchant-dashboard/CustomerReceipt.tsx`; modify `App.tsx`, `docs/CUSTOMER_ORDER_LINKS.md`; create `docs/LOVABLE_RECEIPT_BRIEF.md`. Edit existing Lovable project via its UI.
**Interfaces:** owner controls call Task 1/2 routes through existing authenticated `action`; Lovable uses bearer-only receipt GET/billing PUT and existing checkout POST with permitted receipt capability.
- [ ] Add owner receipt create/copy/revoke/send, explicit customer-consent acknowledgement before send, actual provider status, and protected load of submitted billing details. No raw link in browser storage.
- [ ] Give Lovable exact API contract and extend `/receipt`, add demo receipt/billing states, ES/EN, print view, opt-in at confirmation, safe expired/missing/config errors. Inspect credits and do not purchase.
- [ ] Verify visually at phone width and in browser with fictional data only; check field validation and success status, masked readback, no fake real-API fallback. If generation blocked, preserve exact brief and report blocker.
- [ ] Run `npm test`, `npm run typecheck`, `npm run build:netlify`, `git diff --check`; expect all pass (existing build warnings documented). Update integration instructions and commit.

### Task 4: Review and deliver
- [ ] Request fresh review of the complete extension, using the spec, plan, and diff. Reproduce material findings with a failing test before fixing.
- [ ] Re-run relevant checks after fixes, update existing draft PR and attach it, state the boundary between demo/tests and deployed E2E.

