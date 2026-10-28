import type { RuntimeEnv } from "./auth.ts";

/** Prefer a restricted Twilio API key; retain Auth Token support for older setups. */
export function twilioAuthorization(env: RuntimeEnv): string | null {
  const keySid = env.TWILIO_API_KEY_SID?.trim();
  const keySecret = env.TWILIO_API_KEY_SECRET?.trim();
  if (keySid || keySecret) {
    if (!keySid || !keySecret) return null;
    return `Basic ${btoa(`${keySid}:${keySecret}`)}`;
  }

  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken) return null;
  return `Basic ${btoa(`${accountSid}:${authToken}`)}`;
}
