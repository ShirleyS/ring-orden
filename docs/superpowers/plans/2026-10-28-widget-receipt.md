# Widget receipt implementation plan

**Goal:** After a confirmed-order call ends, put one receipt message and its real Lovable link into that call's stub WhatsApp widget.
**Architecture:** An owner-authenticated endpoint resolves the exact provider conversation, creates a receipt capability and stores its response encrypted for safe retries. The call dialog polls this endpoint after hangup and the existing origin/session-scoped bridge sends `message.received`. No provider message is sent.
**Constraints:** Preserve concurrent work; use CUSTOMER_APP_ORIGIN; never select the latest unrelated order; never call a pending payment paid; never log/cache bearer links in generic request history. Keep the dialog open when hanging up so the caller can open the receipt.
**Review focus:** Unbound conversation, unconfirmed order, duplicate hangup/handshake, revoked link, delayed tool persistence.

- [ ] Add failing API tests for exact-call receipt, retry stability, permissions, revoked links, and draft/unbound calls.
- [ ] Add encrypted receipt response module and narrowly scoped endpoint, excluding it from response caches and general projections.
- [ ] Add tested call receipt controller; connect stop/disconnect, late persistence polling, errors, message bridge replay and visible link.
- [ ] Run complete tests, typecheck and build; deploy dashboard/API configuration and verify Lovable receipt route and actual widget link.
