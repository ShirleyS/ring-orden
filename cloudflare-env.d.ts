declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEMO_MODE?: string;
    TRUST_SITES_HEADERS?:string;
    SUPABASE_URL?:string;
    SUPABASE_SERVER_SECRET?:string;
    APP_ORIGIN?: string;
    SESSION_SECRET?: string;
    MOJOAUTH_JWKS_URL?: string;
    MOJOAUTH_ISSUER?: string;
    MOJOAUTH_AUDIENCE?: string;
    DEEPSEEK_API_KEY?: string;
    ELEVENLABS_API_KEY?: string;
    ELEVENLABS_AGENT_ID?: string;
    AGENT_TOOL_SECRET?: string;
    AGENT_MERCHANT_ID?: string;
    STRIPE_SECRET_KEY?: string;
    STRIPE_WEBHOOK_SECRET?: string;
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_WHATSAPP_FROM?: string;
    TWILIO_WHATSAPP_TEMPLATE_SID?: string;
    SQUARE_ACCESS_TOKEN?: string;
    SQUARE_LOCATION_ID?: string;
    SQUARE_ENVIRONMENT?: string;
    N8N_WEBHOOK_URL?: string;
    N8N_WEBHOOK_SECRET?: string;
  }
}
