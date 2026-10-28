# Browser Phone hosted webhook fix

The supplied preview disables Live webhook registration because its Worker deployment has no verified public-only outbound socket path. Its URL validation, HMAC signatures, quotas, scoped tokens and database are already implemented and must remain intact.

Use the existing Node-only checked-address-pinned transport on RingOrden's existing public API hosting. The relay accepts only explicitly configured HTTPS origins, checks every resolved address, pins the socket address, retains Host/SNI/certificate verification, refuses redirects, and bounds request/response bytes and time. It is not a general forward proxy. Browser Phone uses it only after checking its capability response; absent, failed or mismatched capability remains disabled. Do not set BP_PUBLIC_ONLY_EGRESS to bypass the guard.

No database changes or managed Supabase key extraction are required. The copied transport and IP checks retain their original MIT license under packages/browser-phone-relay/vendor. Existing native Node hosting remains supported. The Lovable server needs only the non-secret BP_PINNED_RELAY_ORIGIN setting after its adapter update is deployed.

Verification required: allowlist rejection, private IPv4/IPv6 and mixed DNS answers, TLS/Host/SNI/pinned lookup, redirects, streaming body bounds, signature/raw-body preservation, remote capability failures, and live registration/pairing with a controlled receiver. A capability response or successful build alone does not prove registration or message delivery.
