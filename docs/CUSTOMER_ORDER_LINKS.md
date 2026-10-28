# Customer order links

Feature branch: `codex/customer-order-links`. Lovable project: https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2 .

This feature resumes an existing order. It does not yet create a fresh customer order from a public menu. It does not enable live Stripe payments.

## Receipt and RFC extension

The customer receipt is a separate grant, not an extension of order-edit access. `POST /api/orders/{order_id}/receipt-link` (OWNER) creates `/receipt#<token>` for a confirmed order, valid for seven days. `DELETE` on that route revokes it; creating another replaces only the old receipt grant. Draft links remain one hour. Cancelled/refunded orders can still show an accurate receipt. Only the digest is stored.

- `GET /api/customer/receipt`: same safe view as the order API, with `editable:false`, empty catalog, and `billing:{status,revision,rfc_masked}`. Status is `NOT_REQUESTED` or `DETAILS_RECEIVED`; no fiscal profile readback.
- `PUT /api/customer/billing`: `{revision:<billing revision>,details:{rfc,legal_name,postal_code,tax_regime,cfdi_use,email?}}`. Returns only the billing summary. RFC is normalized uppercase; validation checks format only, never SAT registration. Postcode is a five-character numeric string preserving leading zeros. Regime and CFDI use are code inputs, not a fabricated complete SAT catalog. Email is optional. Stale submissions/storage conflicts return 409; malformed/extra fields return 422.
- `POST /api/customer/checkout`: receipt grants may open the existing checkout for a confirmed eligible unpaid order. They cannot edit or confirm an order. Payment status comes from the backend, never the return query. Checkout sessions created earlier may retain their original return URL. The customer frontend tracks its active capability in tab storage and routes payment returns back to the appropriate view.
- `GET /api/orders/{order_id}/billing`: OWNER-only full submission. Billing is omitted from bootstrap, all general order responses (including owner), event payloads, manager/staff views and notifications. It is stored in private tenant state: `ring_private.app_state` when the configured Supabase repository is active. No new public table or browser database access is needed.

This collects an optional invoice request for the restaurant. It does not issue, stamp, validate with SAT, or send a CFDI. Receipts explicitly say they are not CFDI. Customer identity/login and reusable fiscal profiles are outside this feature.

### WhatsApp delivery

With `CUSTOMER_APP_ORIGIN` set, automatic confirmation delivery uses receipt mode and the old checkout notification is suppressed. The customer must explicitly choose optional `whatsapp_receipt:true` on `POST /api/customer/confirm`; the bound voice `tools/confirm_order` and owner confirm action accept the same optional flag. The voice agent must ask and record the customer's answer rather than infer consent from a phone number. Repeated confirmation does not resend. Existing deployments without a customer origin keep their legacy notification path.

`POST /api/orders/{order_id}/receipt-send`, OWNER-only, requires `{customer_opted_in:true}` acknowledging customer consent at the order's existing phone. It records consent and explicitly sends/resends without repeating confirmation, POS sync or checkout creation. Resending rotates the receipt grant. The merchant detail has create/copy/revoke, explicit send/resend consent, actual notification status and a protected billing-details view. In customer-portal mode, the old `retry_notification` action also requires recorded consent and uses this receipt sender.

Configure the server-only `TWILIO_RECEIPT_TEMPLATE_SID` separately from the existing checkout template. The approved Spanish template must mean: “Pedido {{1}} · {{2}} · Total {{3}} · {{5}}. Ver pedido, recibo y datos de facturación: {{4}}”. Variables are 1 order reference, 2 items summary, 3 amount/currency, 4 **complete** Lovable receipt URL, 5 payment state. Verify Twilio's approved template accommodates the complete fragment URL and item-summary formatting before real sends. Do not reuse a template whose fourth variable expects only a Stripe session suffix. No template is created or approved by this code.

Missing consent skips sending; missing configuration reports `NOT_CONFIGURED`. Demo mode/order source produces `DEMO_PREVIEW` without a provider call. A durable claim precedes Twilio; status such as `QUEUED` means acknowledgement, not proven delivery/read. Known provider rejection is `FAILED`; ambiguous transport failure is `UNKNOWN`, never automatically retried. Explicit owner retries are allowed; a `PROCESSING` claim blocks competing sends for ten minutes, after which explicit recovery is permitted. A crash after provider acceptance may leave processing until manual recovery. Provider status callbacks/reconciliation are not implemented in this extension. Latest grant/billing fields survive concurrent delivery/POS merges.

Public ingress must additionally allow only `/api/customer/receipt` GET/OPTIONS and `/api/customer/billing` PUT/OPTIONS. Existing exact-origin CORS and capability auth remain in force; keep all owner routes private. Apply optional voice-tool consent to its registered schema before using it. No real messages or live payments were sent during development.

## Server configuration
Set `CUSTOMER_APP_ORIGIN` to the exact HTTPS origin of the customer app, with no path/query/fragment. Loopback HTTP is supported for local development. No new signing secret is required: each link contains 256 random bits and only its SHA-256 digest is stored in the existing durable tenant state.

Issue a link as an authenticated merchant OWNER:

`POST /api/orders/{order_id}/customer-link`, JSON `{}`

Returns HTTP 201 `{ "url": "https://customer.example/order#<token>", "expires_at": "..." }`.

The token is returned once and is not persisted in the idempotency-response cache. Reissuing replaces the previous token immediately. `DELETE /api/orders/{order_id}/customer-link` revokes it. The existing merchant order detail now includes owner-only Create/Replace, Copy and Revoke controls. The complete credential stays only in that open dialog; generating or copying a link never sends a customer message.

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

## Verification on 2026-10-28
- Receipt extension: 362/362 tests pass, typecheck and Netlify build pass. Sixteen receipt tests cover permissions, fiscal privacy, input validation, stale submission, consent, provider ambiguity, revocation during slow notification, receipt reissue for cancelled/refund states, customer checkout returns and stale notification recovery. Independent review reproduced three important extension issues; each was fixed with a failing-then-passing regression test. No material backend finding remains open from that review.
- Lovable receipt generation completed. Independently checked at 375px: no horizontal overflow, five required billing fields, optional email, fictional successful submission with masked acknowledgement and no full-profile readback, ES/EN, paid/pending/cancelled/refund-processing states, expired demo and missing real token. Inspected the generated receipt adapter in the code viewer: receipt GET, billing PUT and checkout POST match this API; credentials omitted/no-store/no-referrer, tab-only capability storage. Corrected raw status labels and refund-state precedence through Lovable; refund processing explicitly says it is incomplete and offers no payment. Lovable reported all 18 frontend tests passing after that correction. Actual live API, provider messages and payment returns are still untested. Screenshot: ignored `outputs/lovable-receipt-rfc.png`.
- Initial order-link implementation: all 346 tests passed, including 19 new customer-link/POS regression checks; typecheck and Netlify production build passed. Existing bundle-size/deprecation warnings remain.
- Independent security/correctness review reproduced two issues (revoked grants restored by stale provider metadata, and multi-unavailable-line repair). Both have failing-then-passing regression tests and were re-reviewed.
- Lovable: verified ES/EN controls, name entry, quantity update, explicit review then confirmation, simulated checkout/pending/paid, and missing-token rejection. The generated API client matches the implemented route/payload names and omits cookies. At 375px, document width is 375px with no horizontal overflow. Screenshots are saved under ignored outputs/.
- Minor demo interaction: a first tap while name autosave is pending may be ignored; controls display Saving while writes run. No real payment or customer message was sent.
- Source was rebased onto published GitHub main bc40e11, retaining newer Supabase sign-in and voice changes. A contextual TypeScript annotation on the existing voice SDK options fixes type widening from that main commit without changing runtime behavior.
- Not yet verified: actual Lovable origin to a public deployed customer API, durable deployed storage, real voice handoff delivery, or Stripe test checkout/webhook end-to-end. Current production is unchanged.
