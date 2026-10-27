# Ring Orden

The supplied product brief is the approved product specification. The user explicitly requests immediate complete implementation with autonomous decisions and no repeated questions. Product and package naming use Ring Orden.

Build a TypeScript monorepo: a responsive React merchant app, server API, deterministic transaction core, merchant-isolated correction memory, provider-neutral model gateway, and POS adapters. Persist demo data in hosted D1, with an accompanying Supabase schema and RLS deployment path. Merchant identity comes from the hosting identity in the private hosted demo and MojoAuth when configured. Real credentials stay server-side.

Demo mode is clearly labeled: its local language parser and simulated payment demonstrate complete workflows without claiming external integrations are connected. Live mode requires verified external configuration. Production prices use integer minor units internally and MXN decimal display. Confirmation is explicit, references are resolved to stable line IDs, ambiguous modifiers ask one question, and payment state changes only on verified webhooks or explicitly labeled demo simulation.

Required UI: overview, orders/details, calls, escalations, memory controls, menu and availability, phone/agent simulator, model compatibility, POS, payments, notifications, analytics, team, settings and onboarding. Credentials-dependent capabilities report setup needed.

Do not purchase numbers, charge real cards, publish merchant data publicly, or claim unrun model benchmarks. Ship MIT code and provider configuration instructions.
