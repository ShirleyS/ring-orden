# Supabase database

Ring Orden uses Supabase Postgres as its selected production database. Project **Ring Orden** is in **ShirleyS's Org**, region `us-east-1`, project ref `yikusfspjihoswcsuddh`. [Open the project](https://supabase.com/dashboard/project/yikusfspjihoswcsuddh).

## Schema and server connection

Apply the SQL files in `database/supabase/migrations/` in filename order. The initial normalized schema, server-only runtime RPCs, and one-time cutover migration have been applied to this project. Keep subsequent changes append-only.

Set `SUPABASE_URL=https://yikusfspjihoswcsuddh.supabase.co` and `SUPABASE_SERVER_SECRET` in the deployed backend environment. Use the project's modern secret key or compatible service-role key. On Netlify, limit the secret to Functions and the intended deploy contexts. On Sites, mark the value as secret and redeploy a saved version to apply the environment revision. No secret belongs in source, a client-prefixed variable, screenshots, or chat. The runtime uses the REST RPC API; it needs no database password or browser database connection.

Both variables are required; a partial configuration fails closed. Supabase takes precedence over the retained D1/Netlify adapters. Existing authentication and merchant role checks remain on the application server. Selecting a database does not enable provider integrations or change hosting visibility.

## Preserving the existing private Site

Before the first Supabase-backed Site deployment, set `SUPABASE_MIGRATE_D1=true` together with both connection variables. The importer uses the existing server D1 binding and performs one read-only batch over merchants, tenant state, memberships, invitations, and processed events. It transfers full JSON state without routing it through a browser or a bounded database viewer.

The service-only import RPC commits all rows and a `sites-d1-v1` completion marker in one transaction, preserving owner IDs, JSON payloads, revisions, timestamps, invitation status, membership metadata, and event IDs. Concurrent first requests are serialized. Ambiguous network failures can retry safely; conflicting existing destination tenants cause the entire import to roll back. No destination tenant is silently overwritten. An import failure returns an unavailable response before application writes proceed.

Drain old D1 writers during rollout. The importer cannot prevent an already-running old deployment from saving after its snapshot. Verify that the source's last revisions remain unchanged after rollout and match the imported records before treating cutover as complete. Retain the source D1 database for recovery. Do not revert to D1 after new Supabase writes without reconciling those newer writes.

After verifying the completed import, remove `SUPABASE_MIGRATE_D1` and redeploy. Leave it unset on Netlify, which has no D1 binding. Different deployment identity providers still have different subjects; a shared database does not automatically link their workspaces.

## Storage and access boundaries

The running application stores each tenant's full working state in `ring_private.app_state`, with compare-and-swap revisions. Separate private tables hold invitations, processed events, and cutover receipts. The normalized public tables remain available for a later normalized-storage implementation; application writes do not populate every normalized order/menu table.

Private tables have RLS, revoked browser-role grants, and no permissive row policies. Public runtime RPCs have fixed search paths and EXECUTE only for `service_role`; their narrow scoped operations check ownership/membership or use the already-authenticated provider/service path. Supabase's informational [RLS without policies notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) is expected for these intentionally inaccessible private tables. Do not add public policies merely to silence it. Newly created indexes may produce [unused-index notices](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index) before traffic arrives.

## Verification

- SQL integration tests execute the actual migrations under Postgres/PGlite and verify tenant isolation, ownership, revision conflicts, invitations, event deduplication, and RPC permissions.
- Importer tests use SQLite-backed D1 snapshots and controlled HTTP responses to verify full data preservation, retries, and failure behavior.
- After activation, verify service-only REST calls with the real server key, and verify browser/publishable-key denial of runtime RPCs and private state.
- Verify the deployed Site's storage report is `supabase`, its existing workspace remains available, and subsequent saves change Supabase state. Keep the Netlify merchant API authenticated during its database checks.

For read-only operational checks:

```sql
select id, counts, completed_at from ring_private.storage_cutovers;
select merchant_id, revision, updated_at from ring_private.app_state;
```

No credentials or tenant payloads should be included in deployment notes or test output.
