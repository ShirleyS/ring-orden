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

n8n source: I — Durable Customer Follow-up, inactive. The imported draft uses the existing service credential reference, claim/ack backend paths and provider-evidence acknowledgements. The existing Lovable app handoff still needs its current URL/intake contract. The current inactive draft’s provider-specific adapter has not been activated or represented as the Lovable integration. Original A–H and numbered workflows are preserved; no untested replacement was activated.

Deployment: the protected public API and the existing private merchant dashboard now run the V2.1 extension. The merchant build retains its existing public Supabase browser settings; a signed-in browser loaded the correct Café Oliva workspace and the Customers navigation. No Supabase schema migration was applied. The Lovable customer project remains unchanged.

Live credential verification: the public API returns 200; the ElevenLabs get_business_info tool successfully fetched the configured merchant from Supabase; n8n's protected Backend access check returned {status:ok, merchant_bound:true}. No credential value was read or unmasked. The backend canonicalizes copied configuration formatting while incoming Authorization headers still require the exact credential.

Structured voice ordering: apply_order_operations accepts a bounded JSON array of canonical operations, validates menu IDs/modifiers/prices through the existing core, preserves correction evidence and order guards, and forbids confirmation inside an edit request. confirm_order uses deterministic consent checking without a second interpretation-model key. Legacy process_order_turn and BYO LLM remain available. Public ingress allows the new tool.

An owner-only POST /api/integrations/elevenlabs/configure-tools and dashboard action can attach the generated tools using the existing server-side provider key and existing workspace secret reference. It preserves unrelated tool IDs and conversation settings, does not delete shared tools, and verifies the saved attachment. Provider errors leave the agent unverified; partially created tool resources are reused on retry. The Netlify provider credential still receives api_key_id_used_as_api_key. The existing authenticated official CLI was used instead, without reading its keyring. All 21 tools were published and verified. The setup script and the backend helper share the same narrow attachment logic; derived inline tool expansion is accounted for in preservation checks.

The n8n draft at https://shirleys.app.n8n.cloud/workflow/dOwxBkk7vSwicPpM remains inactive pending verification of the existing Lovable app handoff. No real WhatsApp message has been sent or delivery verified. The user specifically declined a new Twilio/provider setup; the existing Lovable app is the intended destination. Signed call-end callbacks are implemented and locally tested, but their live provider signing configuration is still absent.

## Tests and evidence

406 tests passed in the full suite after integration; typecheck passed. Dashboard production build passed. SQL tests execute actual migrations/RPCs using PGlite. Browser tests used real local API handlers with synthetic data for profile/preferences, manager/staff boundaries, receipts, optional-email billing, verification, invalid/replaced fragments and responsive styling. These are not live-provider certification.

Screenshots are in ignored outputs/ui-verification. The new n8n draft screenshot is retained separately during handoff. Provider testing used no real customer message or card charge.

## Still blocked or outside this verified increment

1. Live API authentication is verified from both ElevenLabs and n8n. Full voice ordering, notification delivery and recovery are not yet verified end to end.
2. All 21 ElevenLabs tools are attached to the published Main branch. The live first message is Mexican Spanish with AI disclosure, and English/Chinese language presets and native language detection are enabled. A real text conversation with mocking off created canonical phone order RO-1053: one Iced Latte with Oat milk, MXN90, still an unconfirmed draft. The merchant dashboard independently displayed the same saved order/total. Follow-up English and Chinese responses returned the same saved total without confirming. Telephone audio and the signed post-call webhook remain unverified. Netlify provider-admin actions still require correction of the saved provider key; CLI authentication works.
3. Per the user’s clarified scope, links go to the existing Lovable WhatsApp app; no new Twilio/Meta provider setup is required for that handoff. CUSTOMER_APP_ORIGIN, the working private Lovable preview/published URL and its intake contract remain unverified. Automatic approval review blocked Google sign-in observation, and the user must finish that login. The unrelated Browser Phone preview works but is a separate app. No real WhatsApp delivery is claimed.
4. The requested normalized customer/contact/preference/billing/invoice tables have not been added. Current durable JSON storage is reused. A normalized cutover, indexed per-customer queries and large-tenant performance work remain necessary.
5. PAC integration/CFDI issuance, secure invoice documents, completed customer export/erasure, automated retention and a full consent-management product remain unfinished. These are not represented as working.
6. The additional numbered n8n workflows have not received node-level review. Their classification remains unverified; preserve them until audited.
7. Existing direct backend WhatsApp delivery remains in place until the n8n replacement is verified. The older payment-event receiver is preserved; the new outbox does not claim to replace every older asynchronous side effect.
8. Independent review identified and helped fix invoice confirmation, reorder session assignment and verification renewal/polling issues. Its final pass stopped at the account usage limit. The complete implementation has not received a finished independent production review.

## Provider references

Webhook tool and assignment configuration follows [ElevenLabs webhook tools](https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools). The end-of-call handler follows the signed callback model in [ElevenLabs post-call webhooks](https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks). Database boundaries retain service-only grants/RLS as described in [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).

## Link handoff update

The existing owner customer-link endpoint and dashboard controls now accept order, recovery, billing and receipt purposes. Recovery retains the exact canonical unpaid draft and has a fixed ten-minute lifetime. Receipt links require a completed paid order. Billing/receipt links can be revoked separately. Worker claims expose a structured url in addition to the existing message, without persisting plaintext bearer links. Creating/copying a link does not send a message. See LOVABLE_LINK_HANDOFF.md for routes and payloads. All 406 tests and typecheck pass; both standalone deployments include these controls.

Live evidence: /private/tmp/ring-v21-n8n-auth-success.jpg and /private/tmp/ring-v21-live-language-order-test.jpg. CLI attachment report: /private/tmp/ring-v21-cli-tools-report.json (non-secret counts only). No customer message or charge was performed. The synthetic phone-order draft is intentionally left unconfirmed.
