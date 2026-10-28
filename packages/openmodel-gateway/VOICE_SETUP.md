# Browser voice integration

The merchant dashboard's `VoiceCall` component uses the actual `@elevenlabs/client` JavaScript SDK, pinned to `1.32.0`. The component dynamically imports it after the user clicks **Start call**. No microphone request runs on page load or when opening the dialog.

The component calls authenticated `POST /api/voice/signed-url`, then passes its short-lived `signed_url` to `Conversation.startSession({signedUrl, connectionType:'websocket', ...callbacks})`. Signed URLs use WebSocket; WebRTC requires the different conversation-token endpoint. The ElevenLabs API key always stays server-side.

Configure server variables `ELEVENLABS_API_KEY`, `ELEVENLABS_AGENT_ID`, `AGENT_TOOL_SECRET`, and `AGENT_MERCHANT_ID`. The agent merchant binding must match the authenticated merchant receiving the signed URL. The SDK connection is an audio channel; all cart actions still run through authenticated server tools.

Configure the ElevenLabs agent with `prompts/elevenlabs-agent.txt` and webhook tools described in `prompts/elevenlabs-tools.openapi.json`. Use direct ElevenLabs-to-backend webhook tools for the conversation; n8n is optional for per-turn wrappers and background automation. The configured webhook bearer secret is stored in ElevenLabs as a secret, never as a model-generated argument. The server determines merchant identity, never a caller-supplied merchant ID.

Use `get_business_info` and `get_menu` for information-only questions without creating a session or draft order. When the caller starts an order, call `create_session` with a stable, nonblank `request_id` (at most 200 characters) to obtain a server-generated `session_id`. Optional `name` (at most 120 characters) and E.164 `phone` must come from trusted caller metadata or the customer, never a guess. Retry creation with the exact same request ID and body to retrieve the saved result. Use the returned session ID for `process_order_turn`, `get_order_state`, `confirm_order`, and escalation. A known session ID can recover saved order state; automatic conversation-ID-to-session lookup is not implemented. Each new turn needs its own request ID, reused unchanged on retries. Turn and confirmation utterances are limited to 1,500 characters. Confirmation must contain the actual customer consent utterance and `confirmed: true`; never synthesize consent.

The webhook API must be reachable by ElevenLabs. A private demo host's interactive sign-in can prevent external server-to-server callbacks; live deployment must provide an intentionally configured, reachable API with its bearer/signature protections. Stripe webhooks have the same reachability requirement. Do not expose or disable the merchant dashboard's authentication to work around this.

Enable transcript and mode events in the ElevenLabs agent's Advanced settings. The dialog renders actual SDK messages and listening/speaking state, provides mute/end controls, stops microphone tracks and the session on close/unmount, and closes late-arriving sessions if connection was cancelled. SDK 1.32.0 does not expose a public startup AbortSignal: cancelling while its internal connection setup is pending closes the handle as soon as it becomes available; the SDK cleans up its own preliminary microphone stream when startup resolves or rejects. Active-session end/unmount calls endSession immediately. Empty credentials produce setup-needed feedback before microphone permission is requested. Browser voice requires a secure context (HTTPS or local development).

Verification limits: TypeScript compilation validates SDK integration types once the pinned dependency is installed. Without actual ElevenLabs credentials, merchant-bound tool setup, and an explicit human microphone action, a real audio call and external tool round-trip cannot be verified. A typed transaction simulator remains a separate demo and does not prove a live voice integration.

Official documentation verified 2026-10-27:
- https://elevenlabs.io/docs/eleven-agents/libraries/java-script
- https://elevenlabs.io/docs/eleven-agents/customization/tools/webhook-tools
- https://www.npmjs.com/package/@elevenlabs/client
