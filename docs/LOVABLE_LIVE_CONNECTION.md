# Connect the published customer app

Existing project: https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2

Published app: https://ringorden.lovable.app

Backend: https://ring-orden-api-shirleys.netlify.app

The published app returns HTTP 200 without Lovable login. Inspection of its public client bundles shows an absent API origin, no `/customer` route, and an older billing request contract. Backend settings now point to the published app. No provider credential is needed in the frontend.

## Message for the existing Lovable project

Continue this existing RingOrden app. Preserve its styling, demo, order editor, receipt/history screens and existing integrations. Do not rebuild it or add a database, merchant login, payment backend or new WhatsApp provider.

Configure the public build setting `VITE_RING_ORDEN_API_ORIGIN=https://ring-orden-api-shirleys.netlify.app` and ensure the production client actually uses it. It is a public URL, not a secret. Keep `/order#TOKEN` using the existing order/confirm/checkout APIs and exact server prices/revisions. Recovery uses that same saved order and the backend's fixed ten-minute expiry; never clone it or restart the timer.

The normal homepage and fresh `/order` visits must start with an empty order/start-order state. Keep prefilled fictional items exclusively in clearly labeled `/demo` routes. With no valid incoming capability, do not reuse an old tab's order, phone, name or items; this backend does not create new anonymous public orders. Show guidance to call the restaurant or open its authorized order link. Retain tab-scoped restoration only for the explicit matching payment-return flow. An incoming recovery/order token loads only its exact backend order. Caller recognition and name confirmation happen in ElevenLabs through RingOrden, and repeating previous items requires the caller's agreement and the existing verification rules. n8n delivers authorized links and never invents draft contents.

Add the currently missing `/customer` route. Select its mode from `purpose=billing` or `purpose=receipt`. Read TOKEN from the fragment, immediately remove the fragment from the address bar, and retain the token only in memory. Clear previous data on token change or authorization failure. Use `Authorization: Bearer TOKEN`, `credentials: omit`, `cache: no-store` and `referrerPolicy: no-referrer`; never log or send tokens to analytics. Do not use a RingOrden service secret or Supabase credentials.

Billing mode: GET `/api/customer/billing` returns `{purpose,status,required_fields,optional_fields,expires_at}`. Show a Spanish-first form matching the existing design. After explicit consent POST `/api/customer/billing` with `{rfc,legal_name,postal_code,tax_regime,cfdi_use,confirmed:true}` and optional `email`. Do not use PUT or wrap fields in `{revision,details}`. A successful `{status:"ON_FILE",saved:true}` means “Datos fiscales guardados”, not that a CFDI was issued. Existing fiscal data is never returned. A conflicting second submission requires a fresh link.

Receipt mode: GET `/api/customer/receipt` returns `{purpose,merchant:{name,currency},order:{reference,status,payment_status,currency,items,subtotal,tax,fees,total},expires_at}`. Each item has `{name,quantity,unit_price,modifiers:[{name,price_delta}]}`. Render this exact safe response as a read-only receipt using the existing receipt styling. Money is in decimal currency amounts. Do not assume a customer name, revision, edit/payment permission or order ID is present. Show the actual server payment status. Do not enable payment or billing writes with a receipt token, or order access with a billing token. Keep existing demo/history screens separate and do not fall back to fictional orders on a real route.

Handle 401 as invalid/expired/revoked, 403 as denied origin/access, 409 as conflict requiring review or a fresh link, 422 as validation and 503/network failure as unavailable with retry/contact guidance. Disable duplicate submits and never automatically retry a conflicting mutation. Support the existing Spanish/English UI.

Test both new modes, missing/invalid tokens, optional blank email, changed token clearing previous content, read-only receipt behavior, and 375px layout. Preserve existing demo tests. Report the changed files and test results. Do not publish automatically.

## Remaining integration evidence

The URL is a customer UI destination, not proof of a WhatsApp send-message API. n8n's current follow-up draft stays inactive until an actual existing messaging receiver and acknowledgement contract are identified. Customer-link generation alone does not send a WhatsApp message. Signed live call-disconnect callbacks also remain a separate unverified setup step.
