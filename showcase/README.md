# Ring Orden homepage and showcase

A self-contained, bilingual homepage for Ring Orden, with sponsor highlights, open-source links and interactive n8n diagrams. No installation or build is required.

From the repository root:

```sh
python3 -m http.server 8768 --bind 127.0.0.1 --directory showcase
```

Open http://127.0.0.1:8768/ or open `showcase/index.html` directly in a browser. The page has no external font, script or image dependencies.

## Presenting

- Use **English / Español** above the workflow or the language button in the header. Labels, nodes, explanations and page text switch together.
- Click a workflow tab, then a node to read its explanation. On a narrow screen, scroll the diagram horizontally.
- **Present** enters presentation mode. Arrow keys and Page Up/Down move between sections; Escape exits. The control is hidden on small screens.
- Login buttons link to the existing merchant app at https://ring-orden-shirleys.netlify.app/ . Authentication remains in that app; the static homepage does not collect credentials.

## What the diagrams mean

The customer journey covers returning-customer preferences and favorites, an order continued through a Lovable link, consent-gated recovery after an unfinished call, receipt follow-up, RFC collection and pending invoice requests. n8n follow-up steps are highlighted in pink. Memory, canonical orders, verification and billing records belong to the Ring Orden backend. Lovable is the intended customer-screen destination.

The detailed delivery view expands decisions inside the code and backend; its branches are not additional executable n8n IF nodes. POS retry and verified-payment views follow their respective workflow definitions. The diagram is explanatory, not a live execution monitor.

Backend support does not prove a complete live integration. The reviewed follow-up workflow is inactive; messaging, provider callbacks and the Lovable/API handoff still require configuration and end-to-end verification. Collecting billing details or recording an invoice request does not issue a CFDI.

Provider and workflow behavior was reviewed against the local V2.1 customer-automation, customer-memory, call-end and Lovable integration documentation. The checked-in `n8n/` workflow directory on another branch may not contain the later customer follow-up draft. The page neither installs nor activates workflows.

## Verification

The release was checked in the browser and with 64 DOM checks covering every clickable node across four workflow views, both languages, synchronized controls, login destinations, section anchors, unique IDs and portable links. This static addition does not modify the merchant application or deploy a new public homepage automatically.

The source is covered by the repository's MIT license.
