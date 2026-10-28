# Merchant sign-in

The Netlify merchant app uses MojoAuth hosted sign-in with the OIDC authorization-code flow and PKCE. The browser posts the ID token to `/api/auth/session`; the backend verifies RS256, issuer, audience and expiry before issuing the existing secure HttpOnly session cookie. Tokens are cleared from browser session storage after exchange. Team invitation tokens are preserved through login.

Production settings:

- `MOJOAUTH_ISSUER`: `https://ringorden-4e6f326a.auth.mojoauth.com`
- `MOJOAUTH_JWKS_URL`: `https://ringorden-4e6f326a.auth.mojoauth.com/.well-known/jwks.json`
- `MOJOAUTH_AUDIENCE`: `53e2719d-b908-4ff2-8418-cb4a0c306502`
- `SESSION_SECRET`: existing server-only signing secret, at least 32 characters.
- Allowed MojoAuth callback: `https://ring-orden-shirleys.netlify.app`.

The shorter `ringorden.auth.mojoauth.com` domain does not load this project's hosted-login configuration. Production issuer and signing-key settings were corrected and redeployed as Netlify deployment `6ae25e960046f8b0fb9fcfa6`.

MojoAuth magic-link email authentication is enabled. `/api/auth/config` exposes only the public issuer and client ID. No client secret is embedded in the browser.

For returning users, a MojoAuth-verified email is matched against confirmed Supabase Auth users using the server-only admin API. A match retains the `supabase:<id>` subject and existing workspace memberships. Unverified emails and banned existing accounts are rejected. Lookup failures block login instead of creating a new empty workspace. Existing Supabase sessions remain accepted; the browser clears its old session only after MojoAuth login succeeds.

Validation: 412 automated tests passed, TypeScript passed, and the Netlify production build passed. A direct check verified that the correct hosted domain accepts the callback and its domain-branding endpoint returns `status: true` with magic-link sign-in enabled. Completing a real email magic link and returning to the app still requires end-to-end verification with the account owner.
