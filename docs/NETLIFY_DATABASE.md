# Netlify Database storage

Ring Orden's Netlify Functions can use Netlify's managed Postgres database without exposing a database credential to the merchant browser. The repository implements the same contract as D1 and Supabase; the transaction engine and provider adapters are unchanged.

## Runtime construction

The Netlify function owns provider initialization:

```ts
import { getDatabase } from '@netlify/database';
import { NetlifyRepository } from '../apps/api/src/netlify-repository';

const database = getDatabase();
const repository = new NetlifyRepository(async (text, parameters) =>
  await database.sql.unsafe(text, parameters),
);
```

`sql.unsafe` is the provider's API name for a raw SQL string with a separate parameter array. All application values remain parameterized. No user-supplied SQL, table name, or schema name is interpolated.

Pass the repository to `handleRequest(request, runtimeEnvironment, repository)`. Initialize the database within the Netlify runtime so the provider selects the correct production or deploy-preview branch. Existing Supabase configuration remains a supported alternative; don't silently mix the two stores in a single deployment.

## Migration and permissions

The schema-only migration is `netlify/database/migrations/202610270001_ring_orden.sql`. Netlify's migration lifecycle applies it before publication. It creates the `ring_netlify` schema with:

- `app_state`: merchant identity, owner, canonical JSON state, and revision.
- `memberships`: verified user subjects and manager/staff roles.
- `invitations`: hashed, email-bound, expiring, single-use invitation records.
- `integration_events`: provider event deduplication.

The schema and tables revoke default `PUBLIC` privileges; every table has row-level security enabled. There are no browser database grants or browser-facing database keys. The server's database role owns the schema and performs explicitly tenant-scoped SQL after the API verifies identity and role. Deploy with the provider's server connection, not a general public read/write database endpoint.

All merchant reads and normal writes include the verified owner subject or persisted membership. State writes compare the stored revision and atomically increment it, preventing stale overwrites. Payloads must retain their own merchant ID. Owner identity cannot be reassigned by changing JSON. Invitation creation verifies the owner in the insertion query. Invitation consumption and membership creation run as one data-modifying CTE statement; a failure rolls back both changes, and concurrent consumers cannot both win. Provider event IDs are unique.

`loadByMerchant`, `saveTrusted`, `hasEvent`, and `recordEvent` are privileged repository methods for already-verified payment webhooks and service tools. They are not exposed as generic browser operations.

The JSON-state storage is an MVP design with whole-merchant contention and state-size tradeoffs. It is not a normalized per-order database or a cross-host replica of the original D1 store. A new Netlify database starts separately; moving original Site data requires an explicit scoped export/import. No runtime request creates or alters tables.

## Verification

`apps/api/tests/netlify-repository.test.ts` uses PGlite's actual Postgres engine to execute the production migration and repository SQL. It verifies owner isolation, stale/concurrent compare-and-swap rejection, ownership preservation, invitation permission/email/expiry/single-use checks, membership persistence, rollback on membership failure, event deduplication, SQL-injection resistance, revoked direct access, and RLS on all four tables. These tests validate SQL behavior; the actual deployed Netlify database still needs a hosted smoke test.

Run:

```sh
node --experimental-strip-types --test apps/api/tests/netlify-repository.test.ts
```

Official references verified during implementation:

- [Netlify Database API](https://docs.netlify.com/build/data-and-storage/netlify-database/api/)
- [Netlify Database migrations](https://docs.netlify.com/build/data-and-storage/netlify-database/migrations/)

No customer data or provider credential belongs in the public repository.
