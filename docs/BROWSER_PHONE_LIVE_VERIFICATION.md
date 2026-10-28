# Browser Phone delivery verification — 2026-10-28

## Confirmed

- Node relay is deployed on the existing RingOrden public API. Its live capability endpoint reports checked-address-pinned TLS delivery, no redirects, 16 KiB request and 64 KiB response bounds, and only the configured n8n and controlled-probe origins.
- A synthetic signed request traversed the deployed relay to its HTTPS probe. Raw-body and signature hashes matched exactly.
- Live relay requests to a private loopback address and an unapproved public origin both returned HTTP 403.
- Browser Phone repository integration passed 178 tests; 14 database tests were skipped. Type checking and the hosted build passed. Source archive was rebuilt.
- The actual Lovable Browser Phone project is **not Git-connected** to that repository. Its public site was published at https://browser-bell-companion.lovable.app, then the narrow relay patch was applied directly through Lovable and published. Repository pushes alone do not update this project.
- New n8n workflow: **Ring Orden — Browser Phone signed receiver**, ID `ggoqsuSfOl8IBfgD`. Its production receiver is https://shirleys.app.n8n.cloud/webhook/ring-orden/browser-phone. A synthetic pairing request returned HTTP 200 and execution 26 succeeded.
- Final published capability returned `enabled:true`, `transport:node-pinned-relay`, `relay_check.stage:verified`.
- A real registration returned HTTP 201, with pairing delivered HTTP 200 in 2442 ms. n8n execution 29 succeeded. The code received by n8n completed the widget verification endpoint with HTTP 200 and `status:verified`. Scoped credentials and pairing codes were not displayed.
- Root cause: the production edge runtime rejects fetch `redirect:error`. Both relay requests now use supported `redirect:manual`; capability and delivery redirects remain rejected. The deployed project also has the public relay origin explicitly configured. No egress attestation was enabled.

## Still pending

- The tested connection is an API test connection. Browser-local state is not injected or changed by that test; a user-facing widget must register/pair its own connection.
- The n8n receiver deliberately rejects business events unless its signing secret and exact phone origin are configured. The successful pairing bootstrap test is not authenticated message delivery.
- Receipt/RFC/recovery notifications have not been demonstrated arriving in a paired widget session. Existing follow-up workflow I still needs its widget delivery destination and successful acknowledgment path verified.
- No real WhatsApp messages, payment charges, or issued CFDIs were part of these tests. No database migration or managed Supabase credential extraction was required for the relay.
