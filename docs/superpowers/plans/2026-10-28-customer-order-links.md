# Customer Order Links Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer securely finish an existing RingOrden order and open its checkout from a Lovable page.

**Architecture:** Store one expiring hashed customer grant per order in existing tenant metadata. A focused customer module handles the guest surface; server.ts supplies existing pricing, confirmation and delivery policy. The Lovable frontend consumes this API without merchant credentials.

**Tech Stack:** Existing TypeScript, Web Crypto, Zod, Node test runner, Repository CAS, Lovable UI.

**Spec:** docs/superpowers/specs/2026-10-28-customer-order-links-design.md

## Global Constraints
- Use Lovable for the customer pages.
- Use 256-bit random tokens, persist only the SHA-256 digest, expire links after 60 minutes.
- Preserve the existing merchant app and other ongoing work.
- Keep current Stripe test-only limits.
- Only the configured exact HTTPS CUSTOMER_APP_ORIGIN can use browser CORS.

## Review Focus
- A token changed to a different merchant or order must never return that order.
- A link replaced or revoked must stop working immediately.
- A simultaneous merchant edit must reject the stale customer write.
- An unavailable item or changed menu price must not be silently confirmed.
- Repeated confirmation must not send duplicate orders or duplicate checkout creation.

### Task 1: Secure guest capability and order API
**Files:** Create apps/api/src/customer-orders.ts; create apps/api/tests/customer-orders.test.ts; modify apps/api/src/types.ts, apps/api/src/server.ts, apps/api/src/rbac.ts, apps/api/src/auth.ts. Add apps/merchant-dashboard/CustomerOrderLink.tsx and its owner-only order-detail integration.
**Interfaces:** issueCustomerOrderLink(state, order, env) returns {url, expires_at}; handleCustomerOrderRequest(request, env, repo, services) returns Response; customer service callbacks reuse pricing/confirmation/delivery from server.ts.
- [x] Write failing route tests: owner issuance, token-only guest access, exact field allowlist, tampering, expiry/replacement/revocation, roles, CORS, schema rejection, stale revision, repricing and closed restaurant, idempotent confirmation and paid-order immutability.
- [x] Run node --experimental-strip-types --test apps/api/tests/customer-orders.test.ts. Expected: route assertions fail because endpoints are absent.
- [x] Implement grant issuance/verification, guest projection, draft mutations, explicit confirmation and checkout lookup; integrate narrowly with existing server routes.
- [x] Run targeted tests, npm test and npm run typecheck. Expected: all pass. Fix any newly found behavior with a failing regression test first.
- [ ] Commit only this task's files after review.

### Task 2: Lovable frontend and deployment handoff
**Files:** Create docs/CUSTOMER_ORDER_LINKS.md and docs/LOVABLE_CUSTOMER_BRIEF.md. Actual frontend lives in the Lovable project and its exported repository.
**Interfaces:** GET/PATCH /api/customer/order; POST /api/customer/confirm; POST /api/customer/checkout; Authorization: Bearer <fragment token>. Origin is set explicitly in deployment.
- [x] Document exact payloads, response fields, production boundaries and public-ingress integration, including customer_link voice-tool registration.
- [x] Check user Lovable connection; create customer page using the reviewed brief when access exists. If signed out, retain the precise access blocker and finish independent backend work.
- [ ] Verify guest screens and real test checkout in browser; do not infer from unit tests that Lovable or production is deployed.
- [x] Run full suite, typecheck and production build once final source changes settle. Expected: zero test failures, zero type errors and successful build.
- [x] Review the complete branch and report separately what is built, verified and still awaiting external access.
