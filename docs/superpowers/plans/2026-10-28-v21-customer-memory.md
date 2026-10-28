# RingOrden V2.1 incremental implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task.

**Goal:** Extend existing customer links and tenant data with durable customer memory, protected billing requests and asynchronous recovery notifications.

**Architecture:** Preserve Supabase tenant JSON as canonical order storage. New customer module owns tenant-scoped data and safe projections. ElevenLabs calls backend tools directly; n8n consumes backend jobs. Existing merchant UI gains a Customers page.

**Tech Stack:** TypeScript, React, Supabase PostgreSQL, existing Repository/CAS, n8n, ElevenLabs.

**Spec:** `docs/V21_IMPLEMENTATION_AUDIT.md` and user Architecture Update V2.1.

## Global constraints

- Preserve functioning code, MojoAuth, OpenPOS/OpenCorrect and BYO models.
- Always greet Spanish; demo languages es-MX, en-US, zh-CN.
- Caller ID is recognition only; protected access requires backend verification.
- Customer memory and orders remain RingOrden/Supabase authority.
- Recovery expiry is exactly ten minutes; reuse original partial order.
- No provider success without acknowledgement; no CFDI issuance without provider confirmation.

## Review focus

- Cross-tenant customer IDs and session substitution must fail.
- Phone normalization must reject ambiguous malformed values.
- Preference writes must distinguish explicit, inferred and one-time instructions.
- Revoked/expired grants and concurrent state writes must not revive authority.
- Billing/verification secrets must never leak through bootstrap or voice projections.

### Task 1: Customer domain and persistence

Files: create `apps/api/src/customer-memory.ts`, `apps/api/tests/customer-memory.test.ts`, additive SQL migration; modify types only through parent integration.
Interface: pure tenant-state operations and `handleCustomerTool(state, tool, body, session, env)` returning safe results; `handleCustomerMerchant(state, path, method, body, role)` for authorized staff operations. Parent integrates routing/save.
- [ ] Write failing isolation, confirmation, history, inference, billing-status and verification tests.
- [ ] Implement bounded normalized customer/preference/event/billing/invoice records using existing tenant state, plus additive SQL for normalized evolution without duplicate order writes.
- [ ] Verify tests and SQL before live application.

### Task 2: Existing merchant Customers UI

Files: `apps/merchant-dashboard/Customers.tsx`, App.tsx, types.ts.
Interface: GET `/customers`, GET `/customers/:id`, PATCH `/customers/:id`, POST `/customers/:id/preferences`, DELETE `/customers/:id/preferences/:preferenceId`; billing status only in list. Parent supplies backend.
- [ ] Add existing-style customer list/detail, preferences, memory history and order summaries.
- [ ] Make explicit/inferred distinctions clear; restrict controls to OWNER/MANAGER, billing to OWNER.
- [ ] Run typecheck/build and report UI verification boundary.

### Task 3: Durable notifications and recovery

Files: new automation module/tests, existing customer-orders.ts grant-expiry option, n8n workflow JSON/docs. Parent integrates routes.
Interface: `queueCustomerAutomation`, `claimAutomationJobs`, `ackAutomationJob`, `issueRecoveryLink`; jobs store canonical IDs and provider outcome, never independent customer truth.
- [ ] Write failing ten-minute expiry/exact-order, consent, claim/retry/idempotency tests.
- [ ] Implement backend queue and n8n template without real customer sends.
- [ ] Verify tests and document live configuration prerequisites.

### Task 4: Parent integration and voice

Files: API server/types/rbac, public ingress, prompts/config generator, seed/settings policy, deployment docs.
- [ ] Integrate independent modules with existing CAS saves and scoped routes.
- [ ] Add real-handler tests for fresh-session preference persistence, tenant denial and protected history.
- [ ] Integrate customer links ingress and ES/EN/ZH voice contracts.
- [ ] Run full tests/typecheck/build once meaningful fixes pass; deploy only coherent verified package.
- [ ] Record files, database/API/workflow changes, evidence and remaining live blockers.
