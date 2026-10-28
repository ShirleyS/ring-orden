# Lovable customer receipts and billing details

Date: 2026-10-28
Status: proposed extension; awaiting user review. No implementation or deployment claimed.

## Intent and decisions from the user

Lovable should remain the customer's interface after completing an order, as well as the existing place to review/finish/pay. Send the customer a magic link to that Lovable view with their receipt. Customers can register their RFC information there. The user chose WhatsApp delivery to the order's phone number.

Restaurants and customers use RingOrden, without individual Lovable builder accounts. RingOrden maintains the shared Lovable project. The merchant dashboard remains React and the existing API remains the source of order/payment truth.

## Proposed experience

1. Customer completes an order in the voice flow or the Lovable order flow. Keep the explicit confirmation already required by the product.
2. RingOrden saves the confirmation before contacting providers. The existing WhatsApp order summary includes a secure Lovable receipt link, rather than taking the customer straight to Stripe. Capture the customer's agreement to receive this WhatsApp message; do not treat the developer's channel selection as the customer's consent.
3. The Lovable receipt shows restaurant name, order reference, item quantities/modifiers, subtotal/tax/fees/total, fulfillment, and authoritative payment status. A confirmed unpaid order is clearly an order confirmation with payment pending; only backend PAID produces a paid receipt. Cancellation/refund states are explicit. Printed output says it is an order receipt and not a CFDI.
4. If unpaid and eligible, the receipt can open the existing saved Stripe checkout using the same guarded payment endpoint. It cannot edit or reconfirm the order or create a second checkout. The verified webhook updates the same receipt; do not send a second WhatsApp automatically in this first extension.
5. An optional “Datos para mi factura” section collects RFC, name/business name, fiscal postcode, tax regime, and CFDI use. Optional email is for invoice delivery, never a condition for collecting the request. A deliberate submit sends the information to the restaurant, with confirmation “Datos recibidos para facturación”. Billing collection is scoped to this order, without creating a reusable customer account.
6. Restaurant OWNER can view submitted details in the existing order detail. A minimal billing status shows not requested / details received. No screen says issued, stamped, SAT-validated, or invoice sent without a real integration supporting that state.
7. Show Spanish first, with the existing English toggle; match the current warm ivory/green Lovable design and verify phone-width layout. Preserve the original editing demo and add a clearly fictional receipt/billing demo. Demo submissions stay in demo memory and never contact providers.

## Builder choices proposed for this extension

- Receipt links use `/receipt#<token>`, expire after seven days, and are independently revocable/reissuable. Existing editing grants remain one hour and retain their current permissions. Seven days is a product default for review, not a claim about an invoicing deadline.
- A receipt grant permits only this order's safe receipt read, billing-details submission, and opening its existing eligible checkout. It never grants order edits, confirmation, arbitrary merchant data, or other customer profiles. It may show cancelled/refunded receipts without permitting payment.
- Reissuing a receipt link replaces only the old receipt grant. Revocation must remain effective across concurrent POS, payment, notification, and customer writes.
- The server keeps only a digest of each random 256-bit token. The frontend removes the fragment, uses memory/tab-scoped session storage for payment return, and never places tokens or billing details in logs, analytics, URLs, localStorage, provider metadata, or generic idempotency caches. Payment return URLs contain no token.
- Receipt grants can read whether billing details were submitted and a masked RFC summary, not retrieve the previously submitted full fiscal profile. Editing means explicitly replacing the profile with newly entered values. No shared-device fiscal autofill.
- Store full billing details in order metadata in RingOrden's existing tenant repository. Expose them only in an OWNER-authorized detail response; omit them from lists, events, exports, staff/manager views, customer order projections, provider calls, and notifications. This is intentionally narrower than a reusable billing profile product.
- Validate bounded strings and payload sizes; normalize RFC uppercase/spacing, check plausible RFC length/shape and five-digit postcode, and require explicit fiscal regime/CFDI-use codes. These are format checks only. Do not fabricate SAT verification, fiscal eligibility checks, or a complete current SAT catalogue. Label fields clearly and let the restaurant resolve billing errors.
- Use optimistic concurrency for billing submissions and receipt/notification state. A stale update must not overwrite a newer submission or restore a revoked credential. Side-effect merges preserve the latest independent metadata.
- Add an optional WhatsApp opt-in at customer confirmation and an explicit opt-in input for authenticated voice confirmation/link delivery. Missing consent, phone, configuration, or approved template leaves the order saved and reports the actual notification state, without claiming delivery. Do not retroactively notify old orders.
- Retain provider acknowledgement distinction: queued/sent is not delivered/read. Do not automatically retry an ambiguous Twilio timeout. Explicit owner resend is separate from fulfillment and must not reconfirm or reprocess payment/POS. Scope the first implementation to an owner-triggered retry where needed, with visible outcome.
- If issuing/saving a receipt grant fails, no invalid link is sent. Save/claim before the provider call, prevent repeated confirmation from duplicate notifications, and never restore a revoked link during the post-provider merge. A crash after a send remains unknown and requires explicit retry, rather than an automatic duplicate.
- WhatsApp text includes the order summary, accurate payment state, and “Ver pedido, recibo y datos de facturación” link. Never include RFC/fiscal details in the message. Use a dedicated documented template contract when an approved WhatsApp template is required; do not silently reuse incompatible existing template variable meanings. Keep existing behavior for unrelated callers until they adopt the new flow.

## API and integration boundary

Extend the existing capability handler rather than creating another backend in Lovable. Add a receipt GET and a billing PUT under exact customer paths, distinguish editing/receipt tokens, and keep exact-origin CORS, JSON limits, no-store/no-referrer, and bearer-only authentication. The billing write returns only an acknowledgement and masked summary. Extend checkout auth only to the explicitly permitted receipt scope.

Add owner issue/revoke/resend controls for receipts separately from editing links, with existing tenant authorization and no token caching. Keep OWNER billing access in a narrowly scoped detail endpoint so existing bootstrap/list payloads cannot leak it. Provider credentials stay server-side.

Lovable's typed client must match the backend contract. Preserve `/order`, `/demo`, missing-token/expired/error states, and API-not-configured behavior. The new receipt route cannot silently fall back to fictional data. Add readable/printable receipt formatting rather than inventing a tax PDF.

The original checkout has concurrent uncommitted public-ingress/voice/payment changes. Preserve them. This extension stays in the existing feature worktree/PR until integration can be done without overwriting that work. Document the new public exact-path/method allowlist and voice-tool consent contract alongside existing pending deployment instructions.

## Excluded from this extension

- Issuing, stamping, cancelling, or emailing a CFDI; SAT/PAC integration or storing issuer tax certificates.
- Automatic verification of RFC existence or regime/use compatibility.
- Reusable cross-order customer accounts, login, stored billing profiles, marketing subscriptions.
- Restaurant Lovable accounts, rewriting the merchant dashboard, new backend/storage/auth services.
- Live payment enablement, purchased credits, fabricated provider success, or sending messages to real customers during development.

## Verification and delivery

Test receipt scope isolation, expiry/reissue/revoke, tenant isolation, no fiscal/token leakage, billing validation and stale submissions, confirmation/payment accuracy, opt-in gating, provider failures/ambiguous outcomes, duplicate confirmation/webhook behavior, and concurrent provider merges. Test authorized owner access and denied manager/staff access. Run the existing API suite, typecheck, and build after meaningful changes.

Verify the Lovable demo at phone width, EN/ES, receipt print view, billing error/success states, and missing/expired/invalid link behavior. Verify actual API calls and Stripe test return/webhook only when the public API and environment are configured. Report separately what works in the demo, in backend tests, and in the deployed integration. Do not send a real customer message as a test without a specific authorized recipient.

Lovable credit availability may block generation; inspect it before submitting and never purchase/upgrade without the user's instruction. If blocked, finish the reviewable backend/contract and report the specific remaining frontend step.

## Source for billing fields

SAT lists RFC, recipient name/business name, fiscal postcode and tax regime as recipient details, with CFDI use described in its issuing guidance. Collection here is optional self-service; restaurant-assisted requests must remain possible. Do not require a Constancia de Situación Fiscal upload.

- https://www.sat.gob.mx/minisitio/Factura/emite_quenecesitoparafacturar.htm
- https://www.gob.mx/sat/prensa/aclara-sat-que-constancia-de-situacion-fiscal-no-es-requisito-para-emitir-factura-04-2026?idiom=es

