# Ring Orden Implementation Plan

> **For agentic workers:** Use parallel workers for independently owned packages; parent integrates and verifies.

**Goal:** A runnable, polished voice commerce MVP with usable open-source transaction components.
**Architecture:** React/Vinext full-stack app, D1-backed private demo, deployable Supabase RLS schema, provider adapters.
**Tech Stack:** TypeScript, React, Vinext, Zod, Cloudflare D1, Supabase schema, ElevenLabs, DeepSeek, Stripe, Twilio, Square, n8n, MojoAuth.
**Spec:** docs/superpowers/specs/2026-10-27-ring-orden-design.md and original supplied brief.

## Global Constraints
- Ring Orden branding; MIT packages; no client secrets.
- Authenticated tenant scope, authoritative catalog pricing, explicit confirmation, idempotent provider operations.
- Provider integrations are unconfigured until credentials verified; no fabricated benchmarks.

## Review Focus
- Reference ambiguity never silently targets a latte.
- Foreign merchant IDs cannot access another tenant.
- Payment success pages cannot mark a real order paid.
- Memory requires customer confirmation and tenant/catalog filtering.
- Provider failures retain valid orders and expose recoverable errors.

### Task 1: Core
- [ ] Write and run failing core safety tests.
- [ ] Implement canonical schema, catalog pricing, operations, state transitions and fixture catalog.
- [ ] Run multilingual/reference and pricing evaluations.

### Task 2: Intelligence packages
- [ ] Test memory isolation, confirmed-correction detection and ranking.
- [ ] Implement memory, demo interpreter, structured model adapters and compatibility runner.
- [ ] Implement Square and webhook adapters from official documentation, with explicit unsupported manifests.
- [ ] Run package tests.

### Task 3: Server
- [ ] Test authentication, scope, idempotency, confirmation and webhook boundaries.
- [ ] Implement D1 repository, server routes, sessions, Stripe/Twilio/ElevenLabs/MojoAuth boundaries.
- [ ] Add Supabase schema/RLS, n8n imports, environment documentation.
- [ ] Run server tests.

### Task 4: Merchant product
- [ ] Implement dashboard and all requested merchant navigation.
- [ ] Connect order simulator, CRUD, filters, memory controls, configuration and onboarding to API.
- [ ] Verify typecheck, package tests, build, browser flow and mobile layout.
- [ ] Publish private Site with exact source and return source/setup guide.
