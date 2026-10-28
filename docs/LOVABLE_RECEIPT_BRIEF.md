# Extend the existing Lovable RingOrden customer portal

Implement this extension now in the existing project. Preserve the current `/`, `/demo`, `/order`, and the new `/phone` phone/ElevenLabs/chat work; do not reset or rebuild those features. Keep the ivory/forest-green/orange visual design, Spanish-first/English toggle, responsive and accessible controls. Add a beautiful mobile-first receipt portal, linked from the existing demo/phone sample receipt message.

Customer data belongs to RingOrden's existing shared Supabase backend THROUGH the existing RingOrden API. Do not create a Lovable database, new Supabase project, customer login, Stripe integration, or server secrets. Use the existing `VITE_RING_ORDEN_API_ORIGIN` config and client patterns. No actual WhatsApp or provider calls in demos.

## Receipt page

Add real `/receipt#<token>` and fictional `/demo/receipt`. Real receipt token is independent of the existing editing token: seven-day expiry, no order editing or confirmation. Strip the fragment immediately and keep token only in memory/tab sessionStorage; never localStorage, query params, logs or analytics. Keep active capability route/type for restoring payment returns. No-token, expired, invalid and unconfigured-API states must be honest, with no demo fallback. Fake data only on explicitly labeled demo paths.

The receipt should show merchant name, order reference, customer first name, line quantities/modifiers, pickup/dine-in, subtotal/tax/fees/total in decimal pesos, order and authoritative payment status. `PENDING` must say payment pending, never paid; only backend `PAID` yields a paid receipt. Handle cancelled/refund states truthfully. Include readable print styling and “Imprimir recibo”; hide controls and fiscal form in print. The document must say “Este recibo no es un CFDI”. No tax invoice fabrication.

For pending eligible payment, open only existing checkout from POST below; do not collect cards, create a competing checkout, or infer paid from redirects. Existing checkout may return to `/order?payment=returned|cancelled`; when the tab's active capability is a receipt, restore and route to receipt instead of attempting the editing API. Save no RFC details in sessionStorage.

## Exact API contract (implemented in backend feature branch, deployment still pending)

All calls use `Authorization: Bearer <token>`, `credentials: omit`, `cache: no-store`, `referrerPolicy:no-referrer`. JSON mutations require Content-Type application/json. Error body `{error:string}`; 401 expired/replaced, 403 wrong capability, 409 stale/conflict, 422 validation, 503 unavailable.

`GET /api/customer/receipt` returns the existing safe customer view:

```
{
 merchant:{name,currency,language},
 order:{reference,customer_name,items:[{line_id,catalog_item_id,name,quantity,unit_price,modifiers:[{modifier_id,name,price_delta}]}],fulfillment,subtotal,tax,fees,total,currency,revision,status,payment_status,clarification},
 editable:false,catalog:[],can_pay:boolean,expires_at:string,demo:boolean,problems:string[],
 billing:{status:"NOT_REQUESTED"|"DETAILS_RECEIVED",revision:number,rfc_masked:string|null}
}
```

`POST /api/customer/checkout` body `{}` returns `{checkout_url:string}`. Accept only HTTPS checkout.stripe.com. Read verified status after return and offer refresh; no fake status.

`PUT /api/customer/billing` body:

```
{revision:<billing.revision>, details:{rfc:string,legal_name:string,postal_code:string,tax_regime:string,cfdi_use:string,email?:string}}
```

Returns ONLY `{status:"DETAILS_RECEIVED",revision:number,rfc_masked:string}`. No full fiscal profile readback. Replace displayed form values with empty values after success, retain masked acknowledgement only. Refetch on 409 then require review/resubmission. Do not autosave fiscal fields or clear them on failed submit.

Optional “Datos para mi factura” tab, separate from the default “Recibo” tab: RFC, Nombre o razón social, Código postal fiscal, Régimen fiscal (3-digit code), Uso CFDI (e.g. G03, S01), optional email. Link from the receipt using “¿Necesitas factura? Registrar datos fiscales” to switch to the second in-page tab for the same order/capability. Both tabs show the order reference. Keep draft input values in memory when switching tabs, without fiscal browser persistence. Use accessible tablist/tab/tabpanel semantics and keyboard navigation. Clear labels and hints; use text input/inputMode numeric for postcode preserving leading zeros. RFC trim/uppercase, 12–13 plausible chars; postcode exactly 5 digits; legal name max200, optional email max254; regime format 3 digits, CFDI format 1–2 letters and 2 digits. Code inputs with examples are preferable to presenting a made-up exhaustive SAT dropdown. Explicit submit “Enviar datos de facturación” with purpose notice “Estos datos se compartirán con el restaurante para atender tu solicitud de factura.” It is optional, never blocks payment or receipt. Show “Datos recibidos para facturación” and explain the restaurant handles issuance; no SAT validation, stamped/issued/sent invoice claim. Do not require a fiscal certificate upload, an account, or email. Restaurant-assisted requests remain possible.

## WhatsApp opt-in

Before the existing customer's explicit order confirmation, add unchecked optional checkbox “Quiero recibir mi pedido y recibo por WhatsApp al número de mi pedido.” Add optional boolean `whatsapp_receipt` to the existing POST `/api/customer/confirm` body `{revision,reviewed_total,confirmed:true,whatsapp_receipt:boolean}`. No phone is added by this extension; if backend says phone missing, preserve the order, show the error, and let customer turn opt-in off. Do not claim a WhatsApp message was sent from a successful order confirmation alone. Receipt delivery is backend-owned and conditional on configuration/consent; demo must label it simulated.

## Demo and checks

Use fictional Café Oliva data. Link to `/demo/receipt` from demo completion and phone's simulated receipt message, without changing chat/audio behavior. Demo billing submission is memory-only, visibly simulated, no external request or persistent fiscal profile. Add demo paid/pending/cancelled/expired and billing received/error states. Verify ES/EN, 375px no horizontal overflow, format errors, optional fields, success masking/clearing, print styling, missing token, and existing order/phone routes. Fix issues found and report exactly what was tested; do not claim live API, Twilio, or Stripe E2E without doing it.

Final correction applied in Lovable: show friendly ES/EN order/payment labels rather than raw backend enums. A REFUND_PENDING value in either order or payment status must take precedence over PAID and show refund processing without claiming completion or offering payment; REFUNDED in either field must show refunded. Demo includes a refund-processing state; focused regression tests cover contradictory paid/refund status inputs. Existing phone/voice routes remain intact.

## Purchase history follow-up

Add Historial / Purchase history as a third in-page tab. On the explicitly fictional demo receipt, show previous purchases from the same restaurant with date, distinct reference, item summary, total and truthful payment state. Each row opens its own read-only historical receipt, without changing the current receipt/billing order or triggering payments, billing submissions, or notifications. On real receipt links, history stays locked until an independent customer-verification flow is connected. The one-order receipt capability must never authorize a cross-order phone lookup. No real history API or verification success should be fabricated.
