# DG Bridge
A React + Vite web application for working with **air-cargo Dangerous Goods (DG) data** in the [IATA ONE Record](https://onerecord.iata.org/) ecosystem. DG Bridge provides role-based workflows for airlines, shippers, and ground handling agents (GHAs), plus standalone tools for converting between legacy formats (XSDG XML, DG Acceptance Checklist PDFs) and ONE Record JSON-LD.

## Features

- **Role-based UI** — different navigation and pages for `airline`, `shipper`, and `gha` users (see [src/constants/roleConfig.js](src/constants/roleConfig.js)).
- **DG AWB workspace** — manage Air Waybills carrying dangerous goods, run DG checks, and view acceptance checklists.
- **DGD Form** — build and submit Shipper's Declarations for Dangerous Goods.
- **XSDG Converter** — convert between XSDG XML and ONE Record JSON-LD (also exposed as a pre-login helper tool).
- **Acceptance Checklist Converter** — upload a DG Acceptance Checklist PDF and convert it to a ONE Record `cargo:Check` JSON-LD document.
- **Server-side conversion endpoint** — Vite dev plugin ([plugins/convertApiPlugin.js](plugins/convertApiPlugin.js)) exposes the XML ↔ JSON-LD converters as HTTP endpoints during development.

## Getting Started

### Prerequisites

- Node.js 18+ and npm

### Install

```sh
npm install
```

### Run the dev server

```sh
npm run dev
```

Open <http://localhost:5173>.

## Usage

Please refer to https://www.youtube.com/watch?v=CJ7IubhiLec
(You can use the files in the folder "demo data" to try it yourself)

## Configuration

Default endpoints (NEOne base URL, NEOne token URL, GraphDB endpoint, office identifier, AWB storage key) are in [src/constants/defaults.js](src/constants/defaults.js) and can be overridden at runtime from the relevant pages.

## Tech Stack

- **React 18** + **Vite 5**
- **jsonld**, **rdf-ext**, **@rdfjs/serializer-jsonld** — JSON-LD / RDF processing
- **@xmldom/xmldom**, **jsdom** — XML parsing (browser + Node)
- **pdfjs-dist** — PDF rendering and text extraction
- **ESLint** with React + hooks plugins
