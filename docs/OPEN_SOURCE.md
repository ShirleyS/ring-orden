# Ring Orden open-source boundaries

Ring Orden ships four source packages with MIT licenses, tests and separate responsibilities. Infrastructure code can be reused outside the hosted product. Merchant data is not part of the public contribution.

| Package | Public implementation | Private runtime data |
| --- | --- | --- |
| packages/ring-orden-core | Canonical schemas, operations, availability validation, pricing, immutable changes and transition rules | Catalog, pricing policies, customers and actual orders |
| packages/ring-orden-memory | Correction detection/extraction, confirmation gates, reliability, isolated retrieval, contextual evidence and controls | Learned phrases, meanings, observation counts, approvals and usage |
| packages/openmodel-gateway | Provider interface, compatible endpoint adapter, output validation, retry/fallback, compatibility runner and demo interpreter | Keys, endpoint credentials and merchant transaction inputs |
| packages/ring-orden-connect | POS abstraction, capability manifests, Square translation, webhook signing and unsupported-provider boundaries | Credentials, external catalog mappings and submitted orders |

## Public software, private mappings

The algorithm that learns and retrieves a mapping is public code. A café's “purple croissant” → ube_croissant mapping is private merchant data. Another merchant can learn a different meaning. Retrieval filters by merchant, active status and catalog relevance. Memory is contextual evidence, never a command to override the customer or catalog.

Share synthetic fixtures. Do not publish customer names, numbers, transcripts, API credentials, database exports, .wrangler state, production environment files or merchant correction memory. Package examples use fictional inputs.

## Run and inspect

From the monorepo root:

~~~sh
npm ci
npm test
npm run typecheck
~~~

Package READMEs describe entry points and tests. Core also contains a standalone package manifest, JSON schemas and an example executable using native TypeScript support. Its example prints a confirmed two-latte order totaling 183 MXN; the full product demo adds a chocolate croissant and totals 258 MXN.

Controlled schema and adapter tests do not demonstrate credentialed provider certification, model accuracy or measured memory improvement. Run the evaluation tools against configured models and retain actual output before publishing benchmark claims.

The application additionally supplies persistent OWNER/MANAGER/STAFF membership enforcement, email-bound single-use invitations, live business-hour checks, CSV menu import, confirmed-unpaid edits with checkout expiration, and persisted POS retry claims. These application features are outside the four standalone package boundaries.

The optional SupabaseRepository is executable backend code selected with server environment variables. It calls service-only scoped RPCs and stores the current application state in a private per-tenant JSON document. The separate normalized schema/RLS is included for future per-entity storage; the current runtime does not automatically populate every normalized table or subscribe the UI to Realtime. Both D1 and Supabase use backend identity/role checks, tenant-scoped persistence and revision guards. Supabase account deployment remains unverified without credentials.

## Publication status

The authored source is MIT-licensed. A private Sites hosting repository does not by itself constitute a public release. Count GitHub publication only after its repository URL and public visibility are verified. No npm package publishing step or unrun model benchmark is implied by the license.

For a public contribution, create or select a public repository, review source and licenses, exclude runtime/private data, and publish packages, tests, schemas and docs together. Preserve dependency notices and vendored-template licenses. State which integrations were exercised against real test accounts and which remain interface-only or unverified.
