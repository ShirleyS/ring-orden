# Menu photo import

Menu → “Your menu, ready in a photo” accepts one JPG, PNG or WebP image at a time, up to 6 MB. Owners can choose a file or drag it onto the upload section. Photos are normalized locally and sent to the server, which wraps the image in a single-page PDF for Firecrawl's documented `/v2/parse` document OCR and structured JSON extraction. The image is not published on the restaurant website.

The review table lets the owner edit product names, categories and prices, exclude rows, and add selected products to the available catalog. Missing/zero OCR prices and duplicate names start unchecked. A genuinely free item can be explicitly entered as 0 during review. A detected foreign currency blocks import rather than silently converting prices.

Nothing is added during extraction. Owner-confirmed products are committed as one batch to the existing catalog, with duplicate checking, normal catalog validation, revision conflict handling and an idempotent request ID. Existing CSV import remains available.

## Production setup

Set `FIRECRAWL_API_KEY` as a server-only Netlify production Functions environment variable and redeploy. The connected Firecrawl account in chat is separate from the app's runtime credential. The upload section reports when the app's credential is missing. No Firecrawl key is exposed to the browser.

The production Firecrawl key is configured. The Menu upload section includes an owner-only connection check that verifies this credential against Firecrawl and reports remaining credits. Firecrawl is also listed on the Integrations page. The key itself is never returned to the browser.

## Endpoints

- `GET /api/menu/image/status`: owner-only connection presence check.
- `POST /api/integrations/firecrawl/test`: owner-only live authentication and credit check. It returns only connection state and remaining credits, never the credential.
- `POST /api/menu/image/preview`: owner-only multipart `file`; returns editable candidates, warnings and workspace currency; no catalog mutation.
- `POST /api/menu/import`: owner-only `{items, request_id?}`; validates the complete batch before changing the available catalog.

## Why it fits the hackathon

The demo can show a tangible path from a photographed restaurant menu to orderable products. Review is essential: the first synthetic live parser test incorrectly treated a description as an additional free item. The stricter prompt returned the correct two products. Server normalization also requires human confirmation for any zero/unclear extracted price.

Validation: 426 automated tests, TypeScript checking and the Netlify production build passed. The live Firecrawl synthetic document test returned Latte at MXN 78 and Croissant at MXN 65, with the latte description attached to its product. Browser drag-and-drop and a restaurant's real menu photo have not yet been checked in the live merchant UI.

References: https://docs.firecrawl.dev/api-reference/endpoint/parse and https://docs.firecrawl.dev/advanced-scraping-guide
