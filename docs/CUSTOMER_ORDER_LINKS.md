# Customer order links

Feature branch: `codex/customer-order-links`. Lovable project: https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2 .

This feature resumes an existing order. It does not yet create a fresh customer order from a public menu. It does not enable live Stripe payments.

## Server configuration
Set `CUSTOMER_APP_ORIGIN` to the exact HTTPS origin of the customer app, with no path/query/fragment. Loopback HTTP is supported for local development. No new signing secret is required: each link contains 256 random bits and only its SHA-256 digest is stored in the existing durable tenant state.

Issue a link as an authenticated merchant OWNER:

`POST /api/orders/{order_id}/customer-link`, JSON `{}`

Returns HTTP 201 `{ "url": "https://customer.example/order#<token>", "expires_at": "..." }`.

The token is returned once and is not persisted in the idempotency-response cache. Reissuing replaces the previous token immediately. `DELETE /api/orders/{order_id}/customer-link` revokes it. Issuance/revocation currently use the merchant API; merchant dashboard buttons are not included in this feature.

The authenticated voice agent can call `POST /api/tools/customer_link`, JSON `{ "session_id": "<existing session>" }`, with the existing merchant-bound agent-tool bearer secret. It gets the same link result. This endpoint does not send a WhatsApp/SMS message. Connect a consent-aware notification step separately. Do not read a long link aloud or promise a message was sent before its provider acknowledges it.

## Customer API
All routes require `Authorization: Bearer <token>`. Tokens in query parameters or cookies are ignored. Requests use `credentials: omit`. Browser Origin must exactly match `CUSTOMER_APP_ORIGIN`; credentials and wildcard CORS are not enabled.

- `GET /api/customer/order`: safe order view, catalog when editable, permissions, expiry, demo flag and problems. No phone number, merchant credentials, transcripts, internal notes or staff data.
- `PATCH /api/customer/order`: `{ "revision": 1, "operations": [...] }`. Uses core operations, but blocks confirm/cancel/escalate/clarification commands. Only draft orders may be edited. Latest revision is required. No client-supplied prices, status or tenant IDs are accepted.
- `POST /api/customer/confirm`: `{ "revision": 1, "reviewed_total": 74, "confirmed": true }`. Rechecks availability, business hours and server prices. A changed total requires review. Saves before running the existing confirmation delivery flow. Repeated confirmation does not trigger duplicate delivery.
- `POST /api/customer/checkout`: `{}`. Returns `{ "checkout_url": "https://checkout.stripe.com/..." }` only for a confirmed unpaid order with a previously saved checkout. It never collects card information, creates a competing checkout, or infers payment from a redirect. Missing checkout is 503 and requires restaurant assistance.

Money values are decimal currency amounts (74 means MXN 74.00). `order.revision` is the order revision, not the tenant storage revision. Quantity edits may expand a line into multiple lines; always render the returned line IDs. A draft GET quotes current catalog prices without saving. On unavailable catalog entries it returns `problems` and the saved order; show the warning and require removal/substitution before confirmation.

The view's exact field names are defined by `customerView` in `apps/api/src/customer-orders.ts`. `editable` controls editing, `can_pay` means the order is eligible to pay (it does not guarantee Stripe is configured), and `demo` must be visibly labeled. Only a backend `payment_status: PAID` proves payment.

## Public ingress integration
The original checkout has concurrent voice/auth/public-ingress work. This branch deliberately does not copy or overwrite that uncommitted code. Before deploying, integrate these narrow additions into that final ingress:

1. Allow only these exact customer paths/methods, including their OPTIONS preflight, to reach `handleRequest`: `/api/customer/order` GET/PATCH/OPTIONS, `/api/customer/confirm` POST/OPTIONS, `/api/customer/checkout` POST/OPTIONS. Retain existing request-size limits, per-IP rate limiting, no-referrer and no-store headers. Do not expose merchant bootstrap/orders/settings routes.
2. Let customer preflights and GET requests bypass the provider-only JSON-body check. The customer handler enforces origin, bearer grants, routes and JSON mutation bodies itself.
3. Add `customer_link` to the allowed voice tools, retaining existing tool-secret and merchant binding.
4. Set CUSTOMER_APP_ORIGIN on both merchant and public API deployments. The frontend API origin must point at that public API, not the private merchant app. Keep the private merchant app's audience unchanged.
5. Guest confirmation supplies customer return URLs `/order?payment=returned` and `/order?payment=cancelled` to checkout creation without including the order token. The frontend restores its token from tab-scoped sessionStorage and reads verified status. Preserve the newer payment-return fix from the original checkout when integrating this branch, including the optional guest return-URL override. Previously created voice checkout sessions may retain their original return destination; do not create a second competing checkout simply to change it.
6. Verify allowed and rejected CORS in the real preview and deployed origins, a draft from a real voice session, expiry/reissue/revoke, stale simultaneous edits, successful Stripe test payment + webhook, and no duplicate fulfillment. Do not claim production readiness before those checks.

## Known deployment boundary
Unit tests exercise the real handler with the in-memory Repository test double. They do not prove a deployed Lovable page can reach production storage. Backend changes remain isolated until integration with the ongoing voice fixes and the public API is verified.
