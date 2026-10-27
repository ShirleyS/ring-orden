# Ring Orden n8n workflows

Import A–H JSON into a current n8n instance. They are deliberately inactive until credentials and the API origin are configured. Source format uses standard Webhook v2, HTTP Request v4.2, Code v2 and Sticky Note v1 nodes. Imported workflows have not been executed on a hosted n8n account in this build.

Set project variable `RING_ORDEN_API_ORIGIN` to your reachable backend origin. Create Header Auth credentials:

- **Ring Orden inbound webhook secret:** a private header/value for ElevenLabs or your trusted ingress.
- **Ring Orden service bearer token:** `Authorization` = `Bearer <AGENT_TOOL_SECRET>`.
- **Ring Orden verified event secret:** `X-Ring-Orden-Secret` = `<N8N_WEBHOOK_SECRET>`.

Configure `AGENT_MERCHANT_ID` on the backend from its authenticated bootstrap output. Each agent integration is bound to that merchant; callers cannot select a merchant. Use a separate deployment/agent binding for each merchant until a server-side phone-number-to-tenant registry is deployed.

Call workflow G once to obtain `session_id`. Pass the same session ID and a unique `request_id` to each A turn. B must receive `confirmed:true` after the agent has repeated the authoritative summary. C returns relevant private correction evidence; the actual detector, extractor, approval controls, persistence and ranking live in the open-source Memory package and backend. E has a one-minute Schedule Trigger for due failed POS delivery after you publish the workflow. The backend persists exponential retry windows, attempt limits and CAS claims. F creates a callback ticket. H checks the configured model.

For D, point Stripe **directly** to `/api/webhooks/stripe` to preserve the exact signed body. Configure `N8N_WEBHOOK_URL` to D's production webhook; the backend emits only verified paid events after persistence. The initial private Sites demo is behind interactive sign-in, so external Stripe/ElevenLabs/n8n callbacks need a separately deployed public API ingress protected by the included provider signatures and service token. Do not make the merchant dashboard public to solve webhook access.

Provider writes use stable POS/Stripe idempotency keys. Request IDs protect transaction turns. n8n's two HTTP attempts safely retry network failures; unrecoverable execution errors remain visible in n8n execution history. Configure an Error Workflow in n8n for operator alerts.
