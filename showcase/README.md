# Ring Orden homepage and showcase

A self-contained, bilingual homepage for Ring Orden, with sponsor highlights, open-source links and interactive n8n diagrams. It is the application homepage at `/`; the merchant workspace and sign-in live at `/app`. Both Netlify and Vinext use `showcase/index.html` as the canonical homepage source.

From the repository root:

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory showcase
```

Open http://127.0.0.1:8768/ or open `showcase/index.html` directly in a browser for a standalone presentation. The page has no external font, script or image dependencies. To test the homepage together with the workspace, run `npm run dev` (Vinext), or `npx vite --config vite.netlify.config.ts` (Netlify UI). A standalone static server does not provide `/app` or authentication.

## Presenting

- Use **English / Español** above the workflow or the language button in the header. Labels, nodes, explanations and page text switch together.
- Click a workflow tab, then a node to read its explanation. On a narrow screen, scroll the diagram horizontally.
- **Present** enters presentation mode. Arrow keys and Page Up/Down move between sections; Escape exits. The control is hidden on small screens.
- Login buttons link to `/app` on the same origin. Authentication remains in the merchant workspace; the homepage does not collect credentials. Existing root sign-in callbacks, invitations and WhatsApp widget links continue to `/app` with their query and fragment intact.

## What the diagrams mean

The customer journey covers returning-customer preferences and favorites, an order continued through a Lovable link, consent-gated recovery after an unfinished call, receipt follow-up, RFC collection and pending invoice requests. n8n follow-up steps are highlighted in pink. Memory, canonical orders, verification and billing records belong to the Ring Orden backend. Lovable is the intended customer-screen destination.

The detailed delivery view expands decisions inside the code and backend; its branches are not additional executable n8n IF nodes. POS retry and verified-payment views follow their respective workflow definitions. The diagram is explanatory, not a live execution monitor.

Backend support does not prove a complete live integration. The reviewed follow-up workflow is inactive; messaging, provider callbacks and the Lovable/API handoff still require configuration and end-to-end verification. Collecting billing details or recording an invoice request does not issue a CFDI.

Provider and workflow behavior was reviewed against the local V2.1 customer-automation, customer-memory, call-end and Lovable integration documentation. The checked-in `n8n/` workflow directory on another branch may not contain the later customer follow-up draft. The page neither installs nor activates workflows.

## Verification

The release was checked in the browser and with 72 DOM checks covering every clickable node across four workflow views, both languages, synchronized controls, login destinations, section anchors, unique IDs and portable links. The Netlify build emits the showcase as `dist-netlify/index.html` and the workspace as `dist-netlify/app/index.html`. Netlify fallback routes, including `/customer` and `/integration`, use the workspace entry. The Vinext root route returns the same HTML and its `/app` page renders the existing workspace. Publishing requires the normal deployment pipeline.

The source is covered by the repository's MIT license.

## Call intent before ordering

The customer view starts with three branches: information, complaints/help, and ordering. ElevenLabs can answer hours, address and menu questions using `get_business_info`/`get_menu` without creating a session or cart. It must use configured business data and ask staff when information is missing.

The requested complaint policy is immediate acknowledgement and escalation to a designated direct contact, without selling or pushing an order. This policy is shown as proposed until the agent and contact route are configured. The current `request_human`/`escalate_issue` backend returns a high-priority callback ticket with `transfer_available:false`, and requires a saved session. It does not implement a session-free complaint intake, live transfer, or a direct-contact notification. Those gaps must be closed and tested before advertising immediate contact delivery.
