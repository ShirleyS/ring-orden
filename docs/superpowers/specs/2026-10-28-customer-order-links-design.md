# Customer review, finish, and pay

The user approved the customer link proposal in this chat on 2026-10-28. Use Lovable for the customer pages, with the existing RingOrden backend owning orders, prices, availability and payment verification. First release resumes an existing order; full-menu ordering from scratch is later work.

## Customer experience
- A restaurant owner or authenticated voice tool creates a link for one existing order.
- The link opens `/order#<token>` in the customer app. No customer account is required.
- Show restaurant name, order reference, items and modifiers, fulfillment, current total and payment status. Spanish first, with English available in the Lovable brief.
- Draft customers can add/remove items, change quantity/modifiers, set their name and pickup choices, and add a note. They review the server-calculated total before explicit confirmation.
- Confirmed orders are read-only. The customer opens the existing Stripe checkout URL; returning from Stripe never marks an order paid. A later refresh reads the backend's verified payment status.
- Show useful states for an expired/replaced link, stale order, closed restaurant, unavailable item, changed total, missing checkout, cancelled order, and successful payment.

## Boundaries
- Preserve the existing merchant app and other ongoing work. Work on an isolated feature branch; do not deploy or alter production access for this feature while Lovable access is missing.
- Use 256-bit random tokens, persist only the SHA-256 digest, expire links after 60 minutes, and replace a previous grant when generating a new link. Include routing IDs in a base64url envelope bound to that digest. The complete token is carried in the URL fragment and Authorization header, never a URL query.
- Issuance requires OWNER access or the existing merchant-bound agent-tool authentication. Revocation requires OWNER access. Nonowners cannot retrieve link metadata.
- Customer endpoints return an explicit field allowlist with no customer phone, sessions, internal notes, credentials, events, staff, or merchant settings.
- Only the configured exact HTTPS CUSTOMER_APP_ORIGIN can use browser CORS. Loopback HTTP is permitted for development. No credentialed CORS or wildcard origins.
- Validate operations with existing schemas. Require the latest order revision for writes; never accept client prices, statuses or merchant/order IDs. Confirm also requires reviewed_total matching a fresh server quote.
- Use compare-and-swap saves before triggering existing confirmation/delivery processing. Duplicate confirmation must not submit the order twice.
- Keep current Stripe test-only limits. This release does not enable live restaurant payments, create a second payment backend, send messages to customers, or automatically dispatch couriers.

## Deliverables
1. Secure issuance/revocation, guest order/edit/confirm/checkout API and behavioral security tests.
2. Integration notes for the separately evolving public provider ingress.
3. A precise Lovable brief and API contract. Build and verify the actual Lovable page when the user signs in or connects the app. Do not describe locally authored pages as built with Lovable.
