# macstudios.net

**The field guide to running local LLMs on Apple Silicon** — every Mac Studio, Mac mini, and MacBook Pro configuration ever sold (75 configs, 2020–2026) crossed with 35 open-weight models: fit, quantization, speed, context, quality, and true 3-year cost, computed live in the browser. One static HTML file, no backend.

**Live site: https://macstudios.net**

## Submit a benchmark

Own one of these machines? [Submit your real tok/s](../../issues/new?template=benchmark.yml) — accepted reports get folded into the site as ✓ community-verified numbers each month.

## Repo layout

- `index.html` — the entire app (data + UI + methodology)
- `build-seo.mjs` — generates `run/*.html` (per-model pages), `embed.html` (iframe widget), `sitemap.xml` from the dataset in `index.html`. Run with `node build-seo.mjs`.
- `run/` — generated per-model pages ("Cheapest Mac to run X")
- `og-image.png`, `robots.txt`, `sitemap.xml` — site furniture

## Data corrections

Spot a wrong price, spec, or benchmark? Open an issue — every figure's provenance is documented in the site's Methodology panel, and estimates are flagged as estimates.
