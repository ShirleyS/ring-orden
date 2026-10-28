# Ring Orden n8n API

The private merchant dashboard cannot accept unattended n8n callbacks through its Netlify sign-in gate. The API-only project at `https://ring-orden-api-shirleys.netlify.app` runs the same authenticated transaction backend against the existing Supabase repository. It serves no merchant dashboard or account-management API.

## Server configuration

Use Functions scope and Production context for all values:

- `SUPABASE_URL`: the existing Ring Orden project URL.
- `SUPABASE_SERVER_SECRET`: the existing server-only Supabase secret or legacy service-role key.
- `AGENT_MERCHANT_ID`: the approved merchant binding. Caller-supplied merchant IDs do not select a tenant.
- `AGENT_TOOL_SECRET`: a random secret, without `Bearer`, spaces or quotation marks.

In n8n, bind outgoing HTTP requests to Header Auth with header name `Authorization` and value `Bearer ` followed by the exact same service secret. Incoming workflow webhooks use a separate Header Auth credential with header name `X-Ring-Orden-Secret`, matching the private app's `N8N_WEBHOOK_SECRET`.

The health route `GET /api/health` checks required storage configuration without exposing records. `POST /api/automation/health` additionally checks service authentication and the merchant binding and returns only `{ "status": "ok", "merchant_bound": true }`. A healthy public health route does not prove a valid service credential or database access.

## Allowed automation routes

Only POST requests to these automation routes are forwarded to the authenticated backend:

- `/api/automation/retry_failed_pos`
- `/api/automation/model_health`
- `/api/automation/get_memory_context`
- `/api/automation/health`

The existing allowlisted voice-tool routes remain under `/api/tools/`. Internal automation tools are not exposed under that voice-tool prefix. All other API routes return 404, including merchant settings and order-list routes. Requests have a 128 KiB body limit and a 300 requests/minute/IP rate limit.

## Build and deployment

Run from this repository:

```sh
npm run build:n8n-api
netlify deploy --prod --no-build \
  --dir=.netlify/n8n-api/public \
  --functions=.netlify/n8n-api/functions-source \
  --site=87c32c62-e854-4522-992c-16023d33d3de
```

Use the standalone build so runtime dependencies are included and Netlify can discover the function route metadata. Uploading an arbitrary prebuilt ZIP without its metadata can lose the API routes. Redeploy after saving Netlify environment variables.

Set n8n's `RING_ORDEN_API_ORIGIN` to the API-only origin, or use explicit API URLs in each HTTP node. C, E and H use `/api/automation/`; A, B, F and G use `/api/tools/`. Workflow D is the verified payment event receiver and must not be used as Stripe's raw callback URL.

Before publishing the retry schedule, run the authenticated backend check and a manual retry check successfully. A configured URL or a published webhook alone is not a passing integration test. Model-health and real transaction checks also require their provider configuration.
