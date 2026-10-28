# Ring Orden n8n workflows

Import A–H JSON into a current n8n instance. They are deliberately inactive until credentials and the API origin are configured. Source format uses standard Webhook v2, HTTP Request v4.2, Code v2 and Sticky Note v1 nodes. Imported workflows have not been executed on a hosted n8n account in this build.

ElevenLabs can call Ring Orden's authenticated backend tools directly for the spoken transaction. That is the default setup; n8n does not need to run for every spoken turn. A–C, F–H are optional workflow wrappers. E provides background POS retries, and D receives verified payment events for any additional notification or accounting steps you configure. D currently validates/enriches the event; it does not send a notification by itself.

Set project variable `RING_ORDEN_API_ORIGIN` to your reachable backend origin. Create Header Auth credentials:

- **Ring Orden inbound webhook secret:** a private header/value for ElevenLabs or your trusted ingress.
- **Ring Orden service bearer token:** `Authorization` = `Bearer <AGENT_TOOL_SECRET>`.
- **Ring Orden verified event secret:** `X-Ring-Orden-Secret` = `<N8N_WEBHOOK_SECRET>`.

Configure `AGENT_MERCHANT_ID` on the backend from its authenticated bootstrap output. Each agent integration is bound to that merchant; callers cannot select a merchant. Use a separate deployment/agent binding for each merchant until a server-side phone-number-to-tenant registry is deployed.

If using the wrappers, call G with a stable, nonblank `request_id` (at most 200 characters) to obtain `session_id`. G validates the incoming ID before its retrying backend request. Optional `name` and E.164 `phone` must come from trusted caller metadata or the customer. Retry creation with the exact same request ID and body to retrieve its saved result. The backend does not look up sessions by ElevenLabs conversation ID; use `get_order_state` with a known session ID to recover saved order state. Pass that same session ID and a new unique `request_id` to each A turn, reusing the ID and body only when retrying that turn. Turn and confirmation utterances are limited to 1,500 characters. B must receive `confirmed:true` and the customer's exact consent utterance after the agent has repeated the authoritative summary; never substitute a fabricated confirmation. C returns relevant private correction evidence; the actual detector, extractor, approval controls, persistence and ranking live in the open-source Memory package and backend. E has a one-minute Schedule Trigger for due failed POS delivery after you publish the workflow. The backend persists exponential retry windows, attempt limits and CAS claims. F creates a callback ticket, not a live telephone transfer. H checks the configured model.

For D, point Stripe **directly** to `/api/webhooks/stripe` to preserve the exact signed body. Configure `N8N_WEBHOOK_URL` to D's production webhook; the backend emits only verified paid events after persistence. The initial private Sites demo is behind interactive sign-in, so external Stripe/ElevenLabs/n8n callbacks need a separately deployed public API ingress protected by the included provider signatures and service token. Do not make the merchant dashboard public to solve webhook access.

Provider writes use stable POS/Stripe idempotency keys. Request IDs protect transaction turns. n8n's two HTTP attempts safely retry network failures; unrecoverable execution errors remain visible in n8n execution history. Configure an Error Workflow in n8n for operator alerts.
