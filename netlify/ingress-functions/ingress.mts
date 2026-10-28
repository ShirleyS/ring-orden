import type { Config } from "@netlify/functions";
import type { RuntimeEnv } from "../../apps/api/src/auth.ts";
import { handlePublicIngress } from "../ingress.ts";

export default function ingress(request: Request): Promise<Response> {
  return handlePublicIngress(request, process.env as RuntimeEnv);
}

export const config: Config = {
  path: ["/api/tools/*", "/api/automation/*", "/api/customer/*", "/api/webhooks/stripe", "/api/webhooks/elevenlabs", "/api/health"],
  rateLimit: {
    windowLimit: 300,
    windowSize: 60,
    aggregateBy: ["ip"],
  },
};
