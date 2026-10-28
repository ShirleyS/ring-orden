# Customer memory and billing domain

The API's tenant JSON document remains the source of customer/order truth. `customer_memory` is an optional additive field in that document. The repository's existing compare-and-swap persistence must save changes; these helpers do not save or contact providers. No normalized customer tables or live migrations are introduced in this increment. Empty public order tables are not queried.

## Interfaces and integration

`apps/api/src/customer-memory.ts` exports:

- `CustomerMemoryState`: tenant-bound customers, explicit preferences, audit events, billing profiles, invoice requests, pending hashed verification challenges and session verification grants.
- `normalizePhone(input): string | null`: accepts explicit E.164 international numbers and familiar separators. Ambiguous local numbers, extensions, letters and invalid international lengths are rejected. No inferred country prefix is added.
- `handleCustomerTool(state, tool, body, session, env): Promise<unknown>`: recognizes the eight customer tool names below; returns `undefined` for other tools. Supply the canonical session object from `state.sessions`, then persist changes using the existing repository CAS. Never expose the whole customer memory field in bootstrap, voice, logs or generic caches.
- `handleCustomerMerchant(state, path, method, body, role): unknown`: receives path segments beginning with `customers`. OWNER/MANAGER may view and manage profiles/preferences; STAFF is denied. Only OWNER may submit fiscal values through the explicit `/customers/:id/billing` endpoint; owner reads return masked profile metadata.
- `customerIdForOrder(state, orderId): string`: resolves/creates a customer from the same-tenant canonical order's normalized contact. Recognition does not create verified identity.
- `saveCustomerBillingProfile(state, customerId, input)`: trusted owner/capability ingress helper. Validate the capability and exact order/tenant scope before calling it. Accepts required `rfc`, `legal_name`, `postal_code`, `tax_regime`, `cfdi_use`, optional `email`/`alias`/`is_default` and explicit `profile_id` (or `id`) for updates. Omitting profile ID creates a distinct profile, never overwrites a default. IDs are checked against this customer. The first profile defaults automatically; explicitly selecting another default clears the previous default. Returns status/IDs only. It does not verify a contact or issue an invoice.
- Verification issuance/completion helpers described below.

Every domain validation/access failure is an `HttpError`. Customer IDs are generated independently within each tenant. A session binds identity through its canonical `order_id`, order `merchant_id` and normalized `order.customer.phone`; tool body `phone`, `customer_id`, `merchant_id`, `verified` or model assertions do not establish identity or authorization.

## Voice tools

| Tool | Behavior |
| --- | --- |
| `get_customer_context` | Minimal recognition flag, opaque customer ID, verification flag and language; no phone, historical order or fiscal values. Unrecognized contact returns normal-ordering-friendly context. |
| `get_customer_preferences` | Verified sessions receive explicit records and separate inferred suggestions. Unverified sessions receive only bounded string values for `milk`, `temperature`, `sweetness`, `pickup_location` (no digits, `@` or `+`), with `verified: false`, `redacted: true`, `verification_required: true`; arbitrary preferences stay protected. |
| `update_customer_preference` | Permanent writes require current server verification, `confirmed: true` and `scope: permanent`. `scope: order` or `one_time` returns `saved: false` and `requires_order_update: true`; apply the actual one-time instruction through canonical order operations. |
| `get_previous_orders` | Requires verification. At most 20 completed, paid, same-customer canonical order summaries; no phone, address or fiscal data. `mode` accepts `recent`, `most_recent`, `frequent`, with integer `limit` from 1–20. Frequent groups the same catalog/modifier basket and quantities and includes a frequency count. Explicit `location`/`location_id`/`branch_id` filters fail with 422 because canonical orders have no supported branch location field. |
| `reorder_previous_order` | Requires verification and own completed, paid source order. Recreates items/modifiers using current catalog availability, names, prices and merchant pricing limits. Creates a new DRAFT and new session only after all lines validate. Unavailable items return `UNAVAILABLE` without writing a draft. No confirmation, payment or POS submission occurs. |
| `get_billing_profile_status` | Requires verification. Returns `ON_FILE` or `MISSING` and provider status only. |
| `request_invoice` | Requires verification, explicit `confirmed: true`, own paid order and a saved profile. Optional `profile_id` must belong to this customer; otherwise the saved default profile is used. One idempotent request per customer/order; returns `PENDING_PROVIDER`, `issued: false`. No PAC/provider is configured or invoked. |
| `verify_customer` | Returns a safe verification requirement/status and `delivery_status: NOT_CONFIGURED`. Optional generic `/customer?purpose=verify` URL contains no capability. Parent integration may issue/deliver a link through a trusted provider; never return the actual secret link to voice/model output. |

Inference is deterministic: only `COMPLETED` + `PAID` orders contribute quantities; highest item quantity wins with item ID as stable tie-breaker. Milk modifiers and explicit catalog temperature conventions (`iced_`, `hot_`, and the current `latte`/`cappuccino`/`americano` IDs) also produce separately labeled quantity-based suggestions. The inferred favorite is a separate suggestion with evidence count. It never overwrites an explicitly confirmed favorite. No language or allergy inference occurs. Unknown item IDs do not contribute temperature guesses.

## Verification capabilities

`issueCustomerVerificationChallenge(state, session, env)` is a trusted backend/provider helper. It requires configured secure `CUSTOMER_APP_ORIGIN` and a canonical session/contact. It returns `{ url, token, challenge_id, expires_at, customer_id, session_id }` **only for a trusted delivery/owner path**. The URL is `/customer?purpose=verify#<token>`; the fragment avoids sending the token to ordinary HTTP access logs. The result must not enter generic idempotency result caches, voice/model output, merchant bootstrap or logs.

The token is base64url JSON `{ merchant_id, challenge_id, secret }`, where `secret` has 256 bits of cryptographic randomness. Durable JSON stores only SHA-256 of the complete token. `readCustomerVerificationTenant(token)` validates the envelope and supplies a routing hint so ingress can call `repo.loadByMerchant`; it grants no access. The public completion route must independently enforce allowed origin/methods and call `completeCustomerVerification(state, token)`.

Completion checks exact tenant, hash with constant-work comparison, pending/non-expired challenge, current canonical session and matching customer derived from the current order phone. Challenges expire after exactly ten minutes and are single-use. Reissuance replaces pending challenges for that session/customer. Success adds a ten-minute verification grant scoped to that session/customer. Another session cannot use it. Parent persistence must win CAS before reporting success. Expired/revoked grants cannot authorize protected tools.

No live SMS/WhatsApp OTP provider is configured in this module. An owner or trusted contact delivery flow must send the capability to the customer's actual contact. Merely knowing the phone or setting `verified: true` never verifies anyone. Order receipt/billing/recovery capabilities do not themselves create a customer verification grant.

## Merchant API shapes

- `GET /customers` → `{ customers: [...] }`, at most 500, each with `id`, `name`/`display_name`, `phone`, `language`/`preferred_language`, consent flag, timestamps, billing status and canonical order count. It contains no fiscal values.
- `GET /customers/:id` → `{ customer, preferences: { explicit, inferred }, events, orders, billing_status }`, with at most 100 audit events and 50 safe order summaries. Fiscal fields remain excluded even for OWNER; billing endpoint returns masked metadata.
- `PATCH /customers/:id` accepts `name`/`display_name`, `language`/`preferred_language` (`es-MX`, `en-US`, `zh-CN`) and explicit `whatsapp_consent`. It cannot reassign contact identity or tenant.
- `POST /customers/:id/preferences` accepts `key`/`preference_key`, `value`/`preference_value`, `confirmed: true`, `scope: permanent`. Existing key is corrected rather than duplicated.
- `DELETE /customers/:id/preferences/:preferenceId` removes only that customer's preference and retains a non-fiscal audit event.
- `GET /customers/:id/billing` is OWNER only and returns `{ status, profiles }` with ID, alias, default flag, masked RFC suffix, email-presence flag and timestamp. `PATCH`/`POST` are OWNER only and validate strict fiscal fields. Updates require an explicit own `profile_id`/`id`; otherwise a new profile is created. RFC shape validation does not validate SAT registration or CFDI eligibility.

- `POST /customers/:id/data-requests` is OWNER only, accepts `type: export | deletion`, `confirmed: true`, and records/reuses a `PENDING_REVIEW` request with `completed: false`. Owner `GET` lists these review requests. This does not erase canonical order data, generate an export or claim completion.

## Verification evidence and boundaries

The focused test suite covers normalization, tenant/session substitution, caller assertions, permanent/one-time confirmation, explicit/inferred separation, verification token hashing/single-use/expiry/binding, customer-scoped history, catalog repricing, unavailable reorders, role restrictions, billing privacy, multiple profiles/default selection, owner data-review requests, bounded history modes, safe fresh-session food preference recall and idempotent pending invoices.

Remaining limitations: no PAC issuance, live OTP delivery, normalized-table cutover, background retention/deletion scheduler, completed customer export/erasure processing or automated legal retention policy. Existing canonical orders retain their customer contact; preference deletion is not a claim of full erasure. Audit events retain change type/key and timestamp without fiscal values. Live deployed authentication/provider/UI journeys require separate verification.
