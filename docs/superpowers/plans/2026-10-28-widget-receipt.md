# Widget receipt implementation plan

**Goal:** After a confirmed-order call ends, put one receipt message and its real Lovable link into that call's stub WhatsApp widget.
**Architecture:** An owner-authenticated endpoint resolves the exact provider conversation, creates a receipt capability and stores its response encrypted for safe retries. The call dialog polls this endpoint after hangup and the existing origin/session-scoped bridge sends `message.received`. No provider message is sent.
**Constraints:** Preserve concurrent work; use CUSTOMER_APP_ORIGIN; never select the latest unrelated order; never call a pending payment paid; never log/cache bearer links in generic request history. Keep the dialog open when hanging up so the caller can open the receipt.
**Review focus:** Unbound conversation, unconfirmed order, duplicate hangup/handshake, revoked link, delayed tool persistence.

- [x] Add failing API tests for exact-call receipt, retry stability, permissions, revoked links, and draft/unbound calls.
- [x] Add encrypted receipt response module and narrowly scoped endpoint, excluding it from response caches and general projections.
- [x] Add tested call receipt controller; connect stop/disconnect, late persistence polling, errors, message bridge replay and visible link.
- [x] Run complete tests, typecheck and build; deploy dashboard/API configuration and verify the caller receipt/link in the browser fixture.
- [ ] Complete the live spoken order and verify its Lovable receipt after hangup.

## Verification ledger
- Integrated suite: 542 tests pass; typecheck and Netlify build pass.
- Fresh code review: race between automatic demo receipt and widget grant fixed and regression tested.
- Browser fixture: actual VoiceCall and CallerPhone, simulated audio session, real API repository; hangup delivered one receipt and link opened matching RO-RECEIPT-E2E / 100 MXN / PENDING.
- Live deploys: merchant 6ae2878bddd9705ce68c281a; API 6ae2878c525d8f4f11f3bf49.
- Confirmed CUSTOMER_APP_ORIGIN=https://ringorden.lovable.app.
- User explicitly approved moving the agent connection to signed-in merchant_487f76edfb79bd734201f5b1; updated AGENT_MERCHANT_ID in both deployments.
- Original external widget /integration returned 404. Bundled CallerPhone under dashboard /integration replaces that unavailable default destination. Live iframe handshake and ElevenLabs audio connection verified.
- Live spoken order confirmation and resulting Lovable receipt are still awaiting user test input; do not claim this live E2E step verified yet.

## Live receipt result
- Production conversation conv_2201m62ea5kdf8yb852zvsmcprc0 created RO-1051 for Prueba Recibo, one latte / 74 MXN.
- The agent rejected a long concatenated consent and then the clear spoken phrase “Sí, señor.” Order was confirmed through the authorized owner dashboard to isolate receipt delivery.
- End call automatically delivered exactly one receipt message in the production widget. Clicking it opened the real Lovable receipt with RO-1051, Prueba Recibo, one Latte, 74 MXN and payment pending. No payment was simulated or charged.
- Narrow polite-confirmation fix accepts whole-string Sí señor/Sí señora/Yes sir/Yes ma’am/Sí es correcto while preserving refusals/change rejection. Regression tests failed before fix, now entire544-test suite/typecheck/build pass. New API deploy6ae289b6e7615bae06c080a7.
- The new consent-phrase fix still needs a fresh voice-only retest; do not describe that retest as completed. Core post-hangup delivery and real Lovable destination are live-verified.
