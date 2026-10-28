# Deploy Ring Orden on Netlify

Netlify runs the same merchant dashboard and transaction API with a dedicated Vite SPA build and a Node serverless function. The original Sites/Vinext build remains available through `npm run build`.

## Build and deploy

```sh
npm ci
npm test
npm run typecheck
npm run build:netlify
netlify deploy --prod
```

`netlify.toml` publishes `dist-netlify` and routes `/api/*` to `netlify/functions/api.mts`. Installing `@netlify/database` enables Netlify's managed Postgres provisioning; SQL migrations under `netlify/database/migrations/` apply during deployment. The database is durable and tenant-scoped, with revision checks and atomic invitation acceptance. See [database implementation](NETLIFY_DATABASE.md).

## Private merchant access

Set project visibility to **Private**, covering production and previews, in the Netlify dashboard. On a private project Netlify verifies the visitor's login and supplies `context.user` to the server function. Ring Orden discards all client-provided `oai-*` identity headers and only constructs an authenticated identity from that verified context. Anonymous/public requests cannot become a demo merchant. Existing verified MojoAuth sessions remain supported.

Netlify's project privacy settings are controlled in its dashboard, not through a public CLI/API. Without private-project protection or configured MojoAuth, the backend correctly requires sign-in. Do not disable authentication to make a public deploy show data.

## MojoAuth hosted merchant sign-in

The dashboard offers **Sign in with MojoAuth** when these five server variables are configured. Set them in Netlify's **Functions** scope for **Production**, then redeploy the merchant application with this source. Neither a Vite variable nor a client-side secret is needed.

| Variable                 | RingOrden value                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------ |
| `MOJOAUTH_ISSUER`        | `https://ringorden-4e6f326a.auth.mojoauth.com`                                             |
| `MOJOAUTH_JWKS_URL`      | `https://ringorden-4e6f326a.auth.mojoauth.com/.well-known/jwks.json`                       |
| `MOJOAUTH_AUDIENCE`      | `53e2719d-b908-4ff2-8418-cb4a0c306502` (public Client ID)                                  |
| `MOJOAUTH_CLIENT_SECRET` | The matching application's private Client Secret; mark secret, never put it in chat or Git |
| `SESSION_SECRET`         | The generated random 64-character value; mark secret                                       |

In MojoAuth, register this exact Allowed Callback URL on that application:

`https://ring-orden-shirleys.netlify.app/api/auth/mojo/callback`

Enable Authorization Code and the `openid`, `profile`, `email` scopes. The server uses the project's discovery document, PKCE S256, browser-bound state and nonce, and verifies the ID token's RS256 signature, issuer, audience and expiry. The token endpoint currently discovered is `/oauth2/token`; the application-details screen advertises `/oauth/token`. Discovery is authoritative; this code does not guess or hardcode either endpoint. Client credentials and provider tokens stay on the server. Only an encrypted ten-minute transaction cookie and the eight-hour HttpOnly RingOrden session reach the browser.

Routes: GET `/api/auth/config` exposes readiness only; GET `/api/auth/mojo/login` starts sign-in; GET `/api/auth/mojo/callback` completes it; same-origin POST `/api/auth/logout` ends the RingOrden session. These routes work before database initialization. A signed-in MojoAuth merchant sees **Sign out of workspace**. This ends the RingOrden session, not the MojoAuth provider's SSO session; choosing sign-in again may reuse that SSO session.

Keep the existing Supabase database variables. Storage and login provider are independent. MojoAuth subjects use `mojo:` identities and do not automatically inherit a workspace created through Sites, Netlify or Supabase, even when the email matches. Verified ownership and an explicit migration are needed to move an existing workspace; this change does not implement identity linking.

A private Netlify project's hosting gate still comes before application login. Keeping it private preserves that gate, so MojoAuth is not a replacement for Netlify's initial gate in this configuration. Do not expose merchant routes through the public provider-ingress project. Customer receipt/order links retain their independent capabilities and do not gain account-wide purchase history from merchant login.

**Verification boundary:** local signed-token/PKCE tests and application build cover the source flow. A real hosted login, registered callback, matching Client Secret, Netlify environment changes and production deployment must be verified separately. This source change does not configure or deploy those services. See [MojoAuth OIDC documentation](https://mojoauth.com/docs/applications/oidc-applications/) and the project's [discovery document](https://ringorden-4e6f326a.auth.mojoauth.com/.well-known/openid-configuration).

## Storage and existing deployments

Supabase is the selected production database. With `SUPABASE_URL` and `SUPABASE_SERVER_SECRET` configured, the Supabase repository is selected instead of Netlify Postgres. Secrets belong in Netlify's Functions environment settings, never in a Vite-prefixed client variable. Follow [Supabase setup](SUPABASE.md). Existing Netlify Postgres support is retained for rollback; it is not used when Supabase is configured. The `NETLIFY_DB_URL` generated by Netlify is server-only.

The guarded Sites D1 importer preserves that Site's owner IDs, tenant state, memberships, invitations, and processed events in Supabase. Netlify has no D1 binding and must leave `SUPABASE_MIGRATE_D1` unset. Netlify user IDs differ from Sites IDs: sharing a database does not automatically link identities or grant access to another deployment's workspace. Any later identity linking requires verified ownership.

## Provider integrations

Provider API variables are listed in [.env.example](../.env.example) and [backend setup](../demo/backend-setup.md). Deploying does not activate phone numbers, WhatsApp senders, payment keys or POS credentials. The initial deployment retains labeled demo mode and test-only Stripe safety.

A private project blocks unauthenticated external provider callbacks at its hosting gate. For live callbacks, use a separate explicitly configured ingress that preserves bearer/signature validation and shares the same storage. Merchant-facing routes must remain authenticated.

## Source

Primary repository: https://github.com/ShirleyS/ring-orden . The Netlify deployment belongs to the Shirley team and is linked locally through ignored `.netlify/state.json`.
