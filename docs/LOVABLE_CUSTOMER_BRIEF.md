# Lovable customer app

Project: https://lovable.dev/projects/974a7e97-1176-44c5-924c-4d56f275d5e2
Name: Tu Pedido, A Tu Ritmo

Build the customer-facing RingOrden experience in Lovable. Keep the merchant dashboard and transaction engine in their existing repository. Use an exact external API origin supplied by configuration, with no new database, merchant login, payment backend or Stripe connector.

## Experience
Spanish-first with English toggle. Warm ivory (#FAF7F0), forest green (#173D32), restrained orange (#EF7A44). Editorial serif headings, clean sans-serif controls, generous space and accessible 44px targets. Desktop sticky order summary and mobile sticky total/action. Three clear steps: Revisar, Confirmar, Pagar.

`/demo` and the homepage contain clearly labeled interactive fictional sample data only. A small expandable demo-state selector can demonstrate errors, confirmation, payment pending and simulated paid. Never process real payment from demo.

`/order` reads the capability token from the URL fragment only. Keep it in memory or tab-scoped sessionStorage when needed for payment return. No localStorage, analytics, console output, query parameters or third-party token transmission. Use no-referrer. Invalid/missing token or unconfigured API must never fall back to sample data.

Show item/modifier cards, item editor and add-item catalog, first name, pickup/dine-in, optional note, itemized price summary, explicit confirmation, Stripe redirect, pending and verified payment states. No courier delivery or invented pickup promise. Hide internal notes, transcripts, staff and phone information.

## API
Use the exact contract in CUSTOMER_ORDER_LINKS.md. A typed client uses credentials omitted, JSON bodies and Authorization bearer. Always adopt the latest returned server total, order revision and line IDs. Only editable drafts may change. Disable writes during requests and avoid duplicate actions.

Changes to price/order return 409: reload, show the reason and require review again. Unavailable items appear disabled. Show problems[] and block confirmation until resolved. 401 means request a fresh link; 422 is validation; 503/network failure must preserve the order and show retry/contact guidance. No silent resubmission or demo fallback.

Confirm requires `{revision, reviewed_total, confirmed:true}` after explicit review. Checkout returns a Stripe-hosted destination. Payment success query strings never mark paid; refresh GET for verified `payment_status`, with bounded polling and a manual status refresh.

## Verification
Test desktop and 375px mobile, keyboard and focus, modifier groups, removing/adding, expanded quantity line IDs, explicit confirmation, unavailable/expired/missing backend states, ES/EN toggle, paid-state read-only rules. Real API and payment checks remain separate from the sample demo. Do not publish production or provision services automatically.
