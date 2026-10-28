# Stripe integration review

Reviewed 2026-10-27. Scope: existing application code, state interfaces, settings, UI, environment template, and tests. This was a read-only integration audit; no Stripe account changes or real Stripe sandbox/live provider tests were performed. References below use repository-relative paths and the line numbers at review time.

## Current implementation and sound protections

Ring Orden supports a single Stripe account's **test-mode, one-time hosted Checkout** for restaurant orders. It creates a payment link after confirmation, can send that link through WhatsApp, and updates payment status from signed Checkout events. `apps/api/src/payments.ts:68` deliberately rejects live keys; `apps/api/src/settings.ts:101` permits only test-mode settings. Demo payment simulation is separately restricted in `apps/api/src/server.ts:1513`.

Keep these protections when extending the integration:

- Raw-body HMAC verification, signature comparison, and five-minute timestamp tolerance: `apps/api/src/payments.ts:24`.
- Saved Checkout ID, authoritative order amount, currency, and paid-status checks before changing payment state: `apps/api/src/server.ts:999` and `apps/api/src/payments.ts:48`.
- Event deduplication and optimistic state saves: `apps/api/src/server.ts:997` and `apps/api/src/server.ts:1029`.
- An authenticated, merchant-scoped application boundary and owner-only payment actions: `apps/api/src/rbac.ts:26`; non-owner Checkout details are redacted at `apps/api/src/rbac.ts:131`.
- Persisting confirmed orders and claiming delivery before the initial provider call: `apps/api/src/server.ts:536` and `apps/api/src/server.ts:2054`.

## Production blockers and required improvements

### 1. Restaurant settlement has no Connect account boundary — P1

**Evidence:** Checkout uses one global authorization key without connected-account scope (`apps/api/src/payments.ts:90`). Order metadata stores only Checkout ID/URL (`apps/api/src/types.ts:40`); payment settings have no merchant Stripe account mapping (`apps/api/src/settings.ts:98`).

**Impact:** Separate restaurant workspaces currently create payments on the same Stripe account. The implementation cannot settle independent restaurants through Connect or check their readiness to accept payments.

**Fix / acceptance:** Implement the account and charge model chosen by the integration plan, persist verified merchant-to-account mappings, and bind create/expire/refund operations and events to that account and environment. In sandbox tests, two restaurants must receive payments under their respective accounts, and a mismatched account event must not update either order. Retain the live-key guard until production readiness is deliberately enabled.

### 2. Manual Checkout creation precedes durable persistence — P1

**Evidence:** The manual action creates a provider session at `apps/api/src/server.ts:1551`; its tenant save occurs later at `apps/api/src/server.ts:2054`. A failed save returns a conflict, while webhook processing requires the saved session ID (`apps/api/src/server.ts:1012`).

**Impact:** Concurrent edits can leave a usable Checkout session that the application cannot reconcile after payment.

**Fix / acceptance:** Persist a recoverable payment attempt and stable operation identity before the provider request, then reconcile the returned session durably. Inject a state conflict after provider success; retrying must recover the same attempt, retain its session ID, and process its paid event exactly once.

### 3. Initial payment delivery has no stale-claim recovery — P1

**Evidence:** Delivery is marked `PROCESSING` at `apps/api/src/server.ts:548`. Checkout creation and WhatsApp sending happen at lines 555 and 582; their resulting metadata is saved at line 638, with only three save attempts.

**Impact:** A process failure after creating or sending a link can leave a stuck delivery claim or a payment link whose session is not stored.

**Fix / acceptance:** Add recoverable, leased delivery attempts and persist payment results before notification delivery. Restart after injected failures at each boundary; recovery must store the existing session, avoid duplicate payable sessions, and resume notification delivery.

### 4. Refund and broader payment lifecycle handling are absent — P1

**Evidence:** Paid cancellation only enters `REFUND_PENDING` (`apps/api/src/server.ts:1476`). The webhook accepts only Checkout completion and asynchronous-success events (`apps/api/src/server.ts:992`); it has no account/environment binding or refund reconciliation.

**Impact:** A cancellation does not return funds. Refunds, failed/expired sessions, and subsequent lifecycle events cannot be reconciled. A later paid event also needs safe handling when the order is already refunding or refunded.

**Fix / acceptance:** Add authorized, idempotent refund requests with provider identifiers and verified outcome events; handle the lifecycle events required by the selected payment methods. Test duplicate, delayed, out-of-order, failed, and cross-account/environment events. Show “refunded” only after provider confirmation, and preserve fulfillment progress when recording payment facts.

### 5. Billing and Invoicing require separate platform state — P1 for requested scope

**Evidence:** The sole Checkout implementation uses `mode: "payment"` (`apps/api/src/payments.ts:77`). `apps/api/src/types.ts:61` has no platform billing customer, subscription, price, or invoice state; the dashboard exposes order payments only.

**Impact:** Ring Orden cannot charge merchants subscriptions, manage renewals or past-due accounts, offer a billing portal, or track invoices. Restaurant customer payments must remain distinguishable from merchants' Ring Orden fees.

**Fix / acceptance:** Implement the plan's platform billing model with server-selected pricing, a merchant-to-billing-customer mapping, subscription/invoice event reconciliation, and owner-only management. Test subscription purchase, renewal, payment failure, recovery, cancellation, and invoice retrieval in a real Stripe sandbox. Do not describe a Stripe invoice as a jurisdiction-specific fiscal invoice without verifying that requirement separately.

### 6. Current manual tax cannot simply become automatic tax — P1 for requested scope

**Evidence:** A flat configured tax rate is applied in `packages/ring-orden-core/src/pricing.ts:82`. Checkout collapses the already-taxed order total into one price (`apps/api/src/payments.ts:83`); there are no item tax classifications or Stripe Tax integration.

**Impact:** Adding automatic tax to this amount could double-count tax or break exact-total webhook validation. Restaurant meal sales and Ring Orden subscription sales may have different tax responsibilities.

**Fix / acceptance:** Establish liability, applicable registrations, product classifications, address collection, and inclusive/exclusive pricing for each seller. Reconcile the authoritative quote with the provider total without weakening amount verification. Test applicable taxable, exempt, and address-dependent sandbox examples, with no duplicated tax.

### 7. Recorded Stripe events can lose downstream notification — P2

**Evidence:** The event is recorded at `apps/api/src/server.ts:1035` before calling n8n. A downstream failure is logged and acknowledged successfully (`apps/api/src/server.ts:1060`); a repeated Stripe event exits as a duplicate.

**Impact:** Payment state is preserved, but its downstream workflow can be permanently missed.

**Fix / acceptance:** Persist a downstream outbox item with payment processing, retry it independently, and keep consumer idempotency. Force a timeout, replay the Stripe event, and restore the consumer; the workflow must eventually run once.

### 8. Payment disable settings are not enforced — P2

**Evidence:** `enabled` is accepted by `apps/api/src/settings.ts:102`, but delivery checks only the global Stripe key (`apps/api/src/server.ts:553`); the manual action also creates Checkout unconditionally after order eligibility checks (`apps/api/src/server.ts:1537`).

**Impact:** Saving `payments.enabled: false` does not prevent new payment links.

**Fix / acceptance:** Define the default and enforce the setting in every payment-creation path. A disabled workspace must make no Checkout creation request, while already-issued payments must remain reconcilable.

## Deployment boundary

The application correctly dispatches `/api/webhooks/stripe` before merchant-session authentication and verifies its signature (`apps/api/src/server.ts:1094`, `apps/api/src/server.ts:961`). A hosting-wide private-access/login gate can prevent Stripe from reaching this code. Allow signed provider webhooks to reach a public callback ingress sharing the durable repository, while keeping merchant APIs authenticated. Acceptance: an unauthenticated signed sandbox event reaches the handler, an invalid signature is rejected, and an unauthenticated merchant API request remains denied. This audit did not test the deployed hosting gate or webhook reachability.

## Verification limits and acceptance gate

Existing tests cover modified/expired signatures and authoritative amounts (`apps/api/tests/security.test.ts:62`), redirect-only payment claims (`apps/api/tests/workflow.test.ts:167`), confirmation delivery claiming (`apps/api/tests/workflow.test.ts:429`), and signed paid-event deduplication (`apps/api/tests/workflow.test.ts:482`). External responses are controlled; these are **not real Stripe sandbox end-to-end tests**. No test suite was rerun for this documentation-only audit.

Before declaring the expanded integration connected, complete real sandbox onboarding, Checkout payment and webhook delivery, account isolation, subscription/invoice lifecycle, refund confirmation, tax-total reconciliation, and failure/retry recovery using the deployed callback. Keep secrets server-side and out of repository files and browser responses.
