# RingOrden → existing Lovable WhatsApp app

Use the existing Tu Pedido, A Tu Ritmo project:
https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2

RingOrden creates the secure links. The existing Lovable app displays or distributes them. No new WhatsApp provider account is needed for this handoff.

## Link destinations

The user published the existing customer app at `https://ringorden.lovable.app`. Anonymous HTTP access returned 200 on 2026-10-28. `CUSTOMER_APP_ORIGIN` is saved as that exact origin on both RingOrden backends and activated by fresh deployments. Live order, billing, receipt and verification preflights returned 204 for that origin and 403 for an unrelated origin; invalid order/billing/receipt capabilities returned 401. The private merchant app still returns 401 anonymously. The private id-preview address is not the customer destination.

The published frontend inspected on that date does not yet configure `VITE_RING_ORDEN_API_ORIGIN`. Its existing receipt client sends `PUT /api/customer/billing` with `{revision, details}`, while the implemented capability endpoint requires POST with confirmed fiscal fields. It also has `/receipt` but no `/customer` route. Do not claim the forms are connected until these frontend differences are corrected and verified. See LOVABLE_LIVE_CONNECTION.md for the narrow update prompt.

| Purpose            | Link shape                                          | Customer action                                      | Lifetime   |
| ------------------ | --------------------------------------------------- | ---------------------------------------------------- | ---------- |
| Dropped call       | `https://APP_ORIGIN/order#TOKEN`                    | Continue the exact saved partial order               | 10 minutes |
| RFC / factura data | `https://APP_ORIGIN/customer?purpose=billing#TOKEN` | Submit billing details securely                      | 60 minutes |
| Receipt            | `https://APP_ORIGIN/customer?purpose=receipt#TOKEN` | Read the completed order and verified payment status | 60 minutes |

These are shapes, not usable demo credentials. Always use the actual `url` returned by RingOrden. Tokens are random, scoped and revocable; never hard-code one permanent token or put it in a query string.

## Generate links from the merchant dashboard

Open an order → customer link controls → choose the purpose → Create customer link → Copy link. Receipt links require a completed paid order. Recovery requires an unpaid draft. Link creation does not send a message.

Existing owner API, on the authenticated merchant backend:

```http
POST /api/orders/ORDER_ID/customer-link
Content-Type: application/json

{"purpose":"recovery"}
```

Use `billing`, `receipt`, or `order` for the other purposes. The response is `{url, expires_at}` (additional metadata may be present). DELETE on the same endpoint with the same purpose revokes the link. This owner API is intentionally unavailable through the public automation ingress.

## Automated link handoff

RingOrden queues only consented follow-ups. n8n claims them through the existing authenticated worker API:

`POST https://ring-orden-api-shirleys.netlify.app/api/automation/claim_automation_jobs`

Body: `{"worker_id":"n8n-customer-followup","limit":10}`.

Each job supplies `job_id`, `claim_token`, `idempotency_key`, `purpose`, `phone`, `url`, `message`, and `expires_at`. Pass the returned `url` and purpose into the existing Lovable message/link integration. Keep the worker credential server-side. Never put it in a Lovable browser bundle, and never forward it to an unrelated endpoint.

RingOrden persists the job and claim before returning it. Acknowledge through `/api/automation/ack_automation_job` only after the app confirms its accepted message ID. `sent` means accepted by the configured destination, not WhatsApp delivery or read. Ambiguous responses/timeouts remain UNKNOWN and must not be blindly resent. The app's actual message intake contract remains to be confirmed; the new n8n draft stays inactive until that handoff is verified.

## Customer API used by the Lovable forms

Base: `https://ring-orden-api-shirleys.netlify.app`.

- Order recovery: GET/PATCH `/api/customer/order`, POST `/api/customer/confirm`, POST `/api/customer/checkout`.
- RFC form: GET/POST `/api/customer/billing`.
- Receipt: GET `/api/customer/receipt`.

Read TOKEN from the fragment, remove it from the address bar and keep it only in memory (existing order payment-return logic may use tab-scoped storage). Send `Authorization: Bearer TOKEN`, `credentials: omit`, and JSON for mutations. The API accepts only the exact configured customer origin. Keep no-referrer/no-store behavior. Never expose saved fiscal records to the chat UI or claim CFDI issuance from a profile-save response.

Preserve the existing Lovable pages and styling. Add only missing purpose routes. RingOrden remains the authoritative order and customer database.
