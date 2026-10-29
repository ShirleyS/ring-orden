# Lovable customer app

Project: https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2
Name: Tu Pedido, A Tu Ritmo

Build the customer-facing RingOrden experience in Lovable. Keep the merchant dashboard and transaction engine in their existing repository. Use an exact external API origin supplied by configuration, with no new database, merchant login, payment backend or Stripe connector.

## Experience
Spanish-first with English toggle. Warm ivory (#FAF7F0), forest green (#173D32), restrained orange (#EF7A44). Editorial serif headings, clean sans-serif controls, generous space and accessible 44px targets. Desktop sticky order summary and mobile sticky total/action. Three clear steps: Revisar, Confirmar, Pagar.

`/demo` and the homepage contain clearly labeled interactive fictional sample data only. A small expandable demo-state selector can demonstrate errors, confirmation, payment pending and simulated paid. Never process real payment from demo.

Update to the original homepage brief: the normal homepage and a fresh `/order` visit must show a clear empty/start-order state, without fictional items or totals. Keep fictional prefilled orders exclusively under explicitly labeled `/demo` routes. Without an authorized order link, show guidance to start by calling the restaurant; this API does not create new anonymous orders from a public menu. Do not silently reopen an old order from sessionStorage when someone opens a fresh normal URL. Restore a tab-scoped token only for the matching explicit payment-return flow. An incoming authorized link loads exactly its backend draft, including partial items and its original expiry. Recognizing a caller and confirming their name never automatically selects a previous order; the voice flow asks whether they want to repeat it and obtains the necessary authorization.

`/order` reads the capability token from the URL fragment only. Keep it in memory or tab-scoped sessionStorage when needed for payment return. No localStorage, analytics, console output, query parameters or third-party token transmission. Use no-referrer. Invalid/missing token or unconfigured API must never fall back to sample data.

Show item/modifier cards, item editor and add-item catalog, first name, pickup/dine-in, optional note, itemized price summary, explicit confirmation, Stripe redirect, pending and verified payment states. No courier dispatch integration or invented pickup promise. Hide internal notes, transcripts, staff and phone information.

## API
Use the exact contract in CUSTOMER_ORDER_LINKS.md. A typed client uses credentials omitted, JSON bodies and Authorization bearer. Always adopt the latest returned server total, order revision and line IDs. Only editable drafts may change. Disable writes during requests and avoid duplicate actions.

Changes to price/order return 409: reload, show the reason and require review again. Unavailable items appear disabled. Show problems[] and block confirmation until resolved. 401 means request a fresh link; 422 is validation; 503/network failure must preserve the order and show retry/contact guidance. No silent resubmission or demo fallback.

Confirm requires `{revision, reviewed_total, confirmed:true}` after explicit review. Checkout returns a Stripe-hosted destination. Payment success query strings never mark paid; refresh GET for verified `payment_status`, with bounded polling and a manual status refresh.

## Verification
Test desktop and 375px mobile, keyboard and focus, modifier groups, removing/adding, expanded quantity line IDs, explicit confirmation, unavailable/expired/missing backend states, ES/EN toggle, paid-state read-only rules. Real API and payment checks remain separate from the sample demo. Do not publish production or provision services automatically.

## V2.1 extension: existing WhatsApp app and secure forms

Extend this same project; retain its existing pages and WhatsApp integration. The backend is deployed at `https://ring-orden-api-shirleys.netlify.app`. The app's working HTTPS origin and existing message intake still need confirmation. Do not use the lovable.dev editor URL as the customer origin. Do not add a Twilio/Meta account or a second messaging integration.

Use each complete `url` returned by RingOrden, without reconstructing it or changing its token:

| Link | Existing or additional route | Behavior |
| --- | --- | --- |
| Dropped call | `/order#TOKEN` | Load the exact existing partial order through the order API above. Recovery expires within ten minutes; never recreate the order or reset the deadline in the browser. |
| RFC / billing | `/customer?purpose=billing#TOKEN` | Collect fiscal details through the billing API below. |
| Completed receipt | `/customer?purpose=receipt#TOKEN` | Read the receipt API below; show server payment status. |

For each route, remove the fragment after reading it. Keep receipt/billing tokens only in memory; never send them to analytics, error tracking or third-party resources. Use a no-referrer policy. Clear previously displayed customer data when a token changes or authorization fails. A token for one purpose does not authorize another purpose.

### Billing form

Use `GET /api/customer/billing` with `Authorization: Bearer TOKEN` and `credentials: omit`. It returns `purpose`, `status` (`PENDING` or `ON_FILE`), `required_fields`, `optional_fields`, and `expires_at`; it does not return existing fiscal records.

After explicit customer confirmation, submit JSON to `POST /api/customer/billing`:

```json
{
  "rfc": "customer-entered RFC",
  "legal_name": "customer-entered legal name",
  "postal_code": "customer-entered five-digit postal code",
  "tax_regime": "customer-entered three-digit regime",
  "cfdi_use": "customer-entered CFDI use",
  "confirmed": true
}
```

`email` is optional and may be omitted or blank. These placeholders describe fields; do not prefill them as real fiscal data. The response `{ "status": "ON_FILE", "saved": true }` means details were saved. Display “Datos fiscales guardados”; do not claim that an invoice was issued. A different second submission returns 409 and requires a fresh link. Invalid/expired/revoked links return 401, validation errors 422, and an unconfigured service 503. Do not automatically resubmit after a conflict.

### Receipt

Use `GET /api/customer/receipt` with the same capability-only request rules. The response contains `merchant` (`name`, `currency`), `order` (`reference`, `status`, `payment_status`, `currency`, `items`, `subtotal`, `tax`, `fees`, `total`), and `expires_at`. Items contain `name`, `quantity`, `unit_price`, and modifiers with `name` and `price_delta`. Money is in decimal currency amounts. Treat the receipt as read-only; billing records and payment-card details are not part of this response.

### Existing WhatsApp intake

n8n receives `job_id`, `claim_token`, `idempotency_key`, `purpose`, `phone`, `url`, `message`, and `expires_at` from RingOrden's protected worker API. Its eventual handoff must use this app's existing server-side integration. Confirm the actual receiver URL, authorization, request fields, duplicate handling and accepted-message response before configuring or activating it. Keep the RingOrden worker secret and `claim_token` out of the customer frontend and unrelated receivers. A receipt/billing/recovery URL is a bearer capability; avoid logging it.

See [LOVABLE_LINK_HANDOFF.md](LOVABLE_LINK_HANDOFF.md) for merchant link generation and worker claim/ack details. No automatic WhatsApp delivery has been verified.

Delivery orders now use fulfillment.type=delivery and delivery_address. Display the delivery label/address explicitly. Courier dispatch is not automated.
