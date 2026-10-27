# Ring Orden Connect

MIT canonical-order → provider adapter layer. UI does not call a POS directly. All adapters accept Ring Orden canonical transactions and expose conservative capability manifests.

`SquareAdapter({accessToken, locationId, mappings, sandbox:true})` implements actual Square Orders API creation (`POST /v2/orders`) and connection verification. Stable catalog variation IDs and modifier IDs are mandatory in `mappings`; no name guessing is permitted. Canonical money is converted to integer minor units. Retries reuse the same merchant/order idempotency key. An acknowledgement with an order ID is required before sync is reported.

Square's supported currencies and availability depend on the seller location/account. An MXN demo is not proof of Square account support in Mexico. Verify sandbox credentials/location/currency before live use. Square API order creation alone does not guarantee kitchen/POS ticket display; seller fulfillment/payment setup must be verified separately. Orders with nonzero tax or fees are rejected until an explicit merchant tax/fee mapping is implemented, so the adapter cannot silently change the canonical total. This implementation does not advertise order updates, payment sync, catalog import, cancellation or webhooks.

Private/local destinations are rejected and redirects are disabled. Deployment egress restrictions should additionally prevent DNS rebinding to internal addresses.

`CustomWebhookAdapter({url, secret?, headers?})` delivers `{event,idempotency_key,order}` over HTTPS with `Idempotency-Key`, timestamp and optional SHA-256 HMAC signature. Signature bytes cover `<unix_timestamp>.<exact_body>` and header format is `v1=<hex>`. Receiver must validate signature, timestamp freshness and store idempotency keys. It must accept HEAD for the connection test. 2xx delivery means the receiver acknowledged receipt, not that a kitchen ticket was printed.

PoloTab, Parrot, Zettle and generic REST manifests are explicit unsupported skeletons; dashboard-only mode requires no POS. No unsupported write capability is claimed.

```sh
node --experimental-strip-types --test packages/ring-orden-connect/tests/*.test.ts
```

Official docs verified on 2026-10-27:
- https://developer.squareup.com/docs/orders-api/create-orders
- https://developer.squareup.com/reference/square/orders/create-order

Tests validate real payload mapping, integer pricing, retry keys, fail-closed acknowledgement and webhook signatures using transport substitution. They do not claim live account credentials were tested.
