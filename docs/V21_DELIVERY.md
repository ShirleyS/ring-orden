# V2.1 delivery and verification

2026-10-28. This extends the existing customer-links branch; it does not rebuild RingOrden. Read V21_IMPLEMENTATION_AUDIT.md for the initial audit.

## Implemented and locally verified

- Customer recognition normalizes international phone contacts inside each merchant. Caller recognition never grants sensitive access.
- Supabase's existing private tenant-state repository persists customer memory. The actual PostgreSQL migration/RPC test proves reload, role denial and revision protection for the new customer records and encrypted jobs. No duplicate order-history store or live schema migration was introduced.
- Explicit preferences require permanent scope, confirmation and verified customer identity. New calls can recall a bounded whitelist of non-sensitive preferences; arbitrary preferences and history remain protected. Inferred favorites/milk/temperature derive deterministically from completed paid canonical orders.
- Direct typed voice tools cover context, preferences, previous orders, repriced draft reorders, verification, billing status and pending invoice requests. New reorder sessions update the provider tool assignment; confirmation remains separate.
- One-time hashed verification links bind customer and session, expire in ten minutes, and cannot be replayed. Voice output never includes their capability. Consent-aware delivery uses the durable encrypted outbox.
- Multiple saved billing profiles support aliases/default selection and owner-only masked management. Billing forms accept optional email. Invoice requests remain PENDING_PROVIDER; no CFDI issuance is claimed.
- Existing merchant dashboard now has Customers for OWNER/MANAGER, with staff denial, profile/language management, explicit/inferred preferences, favorites, order summaries and memory events. Manager billing is hidden.
- Separate scoped receipt and billing grants cannot edit orders. Customer forms clear URL fragments, display authoritative payment state, and never echo stored fiscal details. Native fallback forms exist; Lovable hosted integration is still separate.
- Recovery grants point to the exact existing partial order and expire within ten minutes. Signed ElevenLabs end-of-call callbacks bind agent/conversation, require prior purpose-specific consent, deduplicate and discard transcripts/audio.
- Receipt completion queues only with previously recorded receipt consent. Worker claims persist before payload disclosure; ambiguous provider sends remain UNKNOWN and never blindly repeat. Bearer links are encrypted at rest in the outbox.
- New calls start in Spanish. Source voice policy supports Spanish, English and Chinese; Chinese consent tests reject refusal, uncertainty and questions.

## Files and API/workflow changes

Domain modules: customer-memory.ts, customer-automation.ts, customer-capabilities.ts, followup-events.ts. Existing server/types/rbac/customer-orders/seed and public ingress integrate them without replacing authentication, POS, correction memory or BYO LLM.

Merchant routes: GET/PATCH customers; preferences POST/DELETE; owner masked billing and billing writes; owner verification-link issuance; owner export/deletion review requests. Review requests are PENDING_REVIEW, not completed erasure/export.

Public capability routes: /api/customer/order, confirm, checkout, receipt, billing and verify with exact method/origin/capability controls. Signed /api/webhooks/elevenlabs is optional and requires its own signing secret and exact agent/merchant binding. Worker claim/ack endpoints are only on the public /api/automation namespace, not the voice allowlist.

n8n source: I — Durable Customer Follow-up, inactive. The imported draft uses the existing service credential reference, claim/ack backend paths and provider-evidence acknowledgements. The WhatsApp provider endpoint and credential still need configuration. Original A–H and numbered workflows are preserved; no untested replacement was activated.

Deployment: API source deployed to the existing ring-orden-api-shirleys project. The private merchant deployment and hosted Lovable customer app were not replaced by this increment. The agent's live greeting was already Spanish; its Tools screen showed no attached tools, and no post-call webhook was configured. A workspace secret was saved by the user and the first tool form prepared, but provider UI has not confirmed attachment. Do not claim the full live call journey works.

## Tests and evidence

400 tests passed in the full suite after integration; typecheck passed. Dashboard production build passed. SQL tests execute actual migrations/RPCs using PGlite. Browser tests used real local API handlers with synthetic data for profile/preferences, manager/staff boundaries, receipts, optional-email billing, verification, invalid/replaced fragments and responsive styling. These are not live-provider certification.

Screenshots are in ignored outputs/ui-verification. The new n8n draft screenshot is retained separately during handoff. Provider testing used no real customer message or card charge.

## Still blocked or outside this verified increment

1. Live API health returns 503 because the saved AGENT_TOOL_SECRET still has a Bearer prefix, quotes or surrounding whitespace. Correcting it requires the user's credential save, followed by deployment and authenticated health verification. Only formatting status was exposed; secret values were never displayed.
2. ElevenLabs API tool attachment/publishing, Chinese live language configuration, post-call webhook signing setup and fresh telephone call tests remain unverified. A tool-create form rejected an earlier invalid editor representation; validation was corrected, but the UI has not confirmed creation.
3. Customer app origin, actual Lovable API integration and WhatsApp provider URL/credential/template must be configured and tested before activating workflow I. No real WhatsApp delivery has been verified.
4. The requested normalized customer/contact/preference/billing/invoice tables have not been added. Current durable JSON storage is reused. A normalized cutover, indexed per-customer queries and large-tenant performance work remain necessary.
5. PAC integration/CFDI issuance, secure invoice documents, completed customer export/erasure, automated retention and a full consent-management product remain unfinished. These are not represented as working.
6. The additional numbered n8n workflows have not received node-level review. Their classification remains unverified; preserve them until audited.
7. Existing direct backend WhatsApp delivery remains in place until the n8n replacement is verified. The older payment-event receiver is preserved; the new outbox does not claim to replace every older asynchronous side effect.

## Provider references

Webhook tool and assignment configuration follows [ElevenLabs webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools). The end-of-call handler follows the signed callback model in [ElevenLabs post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks). Database boundaries retain service-only grants/RLS as described in [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
