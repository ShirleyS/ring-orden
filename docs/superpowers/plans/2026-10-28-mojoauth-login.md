# MojoAuth Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Connect hosted MojoAuth login to the existing merchant session.

**Architecture:** Server OIDC code exchange with PKCE, nonce and an encrypted transaction cookie. The dashboard discovers readiness from a public configuration route and uses same-origin session cookies.

**Tech Stack:** TypeScript, Web Crypto, Fetch, React, Node test runner.

**Spec:** `docs/superpowers/specs/2026-10-28-mojoauth-login-design.md`

## Global Constraints

- No dependency additions, credential rotation or deployment.
- Keep existing storage, customer capability routes and Supabase login.
- Provider tokens and client secrets remain server-only.
- Use discovery; fail closed on invalid identity or transaction.

## Review Focus

- Missing or expired transaction must not create a session.
- Discovery must not redirect secrets to another host.
- Wrong nonce, signature or audience must fail.
- Public login must work before database configuration.
- New provider identities must not inherit another merchant by email.

### Task 1: Hosted login and dashboard entry

**Files:**

- Create: `apps/api/src/mojoauth-login.ts`, `apps/api/tests/mojoauth-login.test.ts`
- Modify: `apps/api/src/auth.ts`, `apps/api/src/server.ts`, `netlify/functions/api.mts`, `apps/merchant-dashboard/App.tsx`, `apps/merchant-dashboard/supabase-auth.ts`, `docs/NETLIFY.md`, `.env.example`

**Interfaces:**

- Consumes: `verifyMojoToken`, `makeSessionCookie`, `identityFromRequest`.
- Produces: `handleMojoAuthRequest(request, env): Promise<Response | null>`, public GET `/api/auth/config`, GET `/api/auth/mojo/login`, GET `/api/auth/mojo/callback`, same-origin POST `/api/auth/logout`.

- [x] **Step 1: Write failing integration tests.** Exercise real RSA signatures and encrypted cookies, mocking only external discovery/token/JWKS calls. Cover complete session-to-bootstrap, PKCE parameters, missing config, tampered/missing/expired state, nonce/signature/issuer/audience failures, hostile discovery, denied login, and logout method/origin restrictions.
- [x] **Step 2: Run tests and verify RED.** Run `node --experimental-strip-types --test apps/api/tests/mojoauth-login.test.ts`. Expected: failures for absent routes.
- [x] **Step 3: Implement server handler and dashboard UI.** Dispatch auth before storage, use discovered endpoints, encrypt the transaction, verify ID token nonce and claims, expose readiness only, show login and safe error, add session logout.
- [x] **Step 4: Verify GREEN and build.** Run `npm test`, `npm run typecheck`, `npm run build:netlify`. Expected: all tests/typecheck pass and build succeeds.
- [x] **Step 5: Document configuration and commit.** Record exact callback, secret requirement, identity separation, private hosting gate, and unverified live login. Commit source and tests; review before pushing the existing authorized draft PR.
