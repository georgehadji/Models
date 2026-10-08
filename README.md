# OpenRouter Model Atlas

A zero-dependency web app that fetches the model catalogs from [OpenRouter](https://openrouter.ai) and charts
pricing, context windows, capabilities, modalities, reasoning support, benchmarks, image generation and
video generation models.

## Run it

```sh
npm start            # serves the app on http://127.0.0.1:8000 with a built-in API proxy
```

Open the page and it loads the live catalog. No build step and no runtime dependencies (Node ≥ 18 only
for the dev server and scripts). You can also open `index.html` from any static host; the proxy just
covers browsers or networks that block the direct cross-origin call.

Other ways to get data in:

| Command / control | What it does |
|---|---|
| `npm run snapshot` | Saves all three catalogs to `data/snapshot.json`; the app falls back to it when the API is unreachable. Set `OPENROUTER_API_KEY` to send an auth header. |
| **Import JSON** button | Load a saved `/models` response or snapshot file. |
| **Save snapshot** button | Download what is currently loaded as a snapshot file. |
| **API key** field | Optional `Authorization: Bearer` header. Kept in the tab's session storage only. |

The app tries sources in order: OpenRouter API directly → local proxy (`/api/openrouter/*`) → `data/snapshot.json`.

## What's charted

| Section | Charts |
|---|---|
| Overview | Stat tiles: model and provider counts, free and reasoning-capable models, median input/output price, largest context, image/video model counts |
| Pricing | Cheapest and most expensive models (input vs output $/1M), input and output price distributions, price vs context scatter (log–log, reasoning vs non-reasoning) |
| Capabilities | Capability coverage, models per provider, provider × capability heatmap, input and output modalities |
| Context | Largest context windows with max output tokens, context-length distribution |
| Reasoning | Reasoning stat tiles (always-on, optional, `reasoning.max_tokens`, separately priced reasoning tokens), supported effort levels, reasoning models per provider |
| Benchmarks | Artificial Analysis Intelligence / Coding / Agentic indices, intelligence vs price scatter |
| Timeline | Models added per month (last 24 months) |
| Image generation | Price per generated image, token prices of image-output models, Image API parameters matrix |
| Video generation | Max duration, lowest listed pricing SKU, resolution and feature matrix |
| Explorer | Sortable table of every model with CSV export |

One filter row scopes every chart, tile and table: search, provider, input modality, output modality,
free/paid, required capabilities (reasoning, tools, image input, structured outputs) and ranking size.
Each chart has a **Table** toggle that shows the same data as a table, and supports hover and keyboard tooltips.
Light and dark themes follow the OS setting or the **Theme** button.

## Data sources and field mapping

Endpoints (base `https://openrouter.ai/api/v1`):

- `GET /models?output_modalities=all`: the LLM catalog. Without `output_modalities=all` the endpoint
  returns only text-output models.
- `GET /images/models`: the image generation catalog (parameters, streaming support).
- `GET /videos/models`: the video generation catalog (durations, resolutions, aspect ratios, audio, pricing SKUs).

How fields become chart values (`src/data.js`):

- **Prices** come as USD-per-token strings and are shown per 1M tokens. A negative price (used for
  dynamic routers) is treated as unknown and left off the charts. *Blended* = (3 × input + output) / 4.
- **Free** means a `:free` id suffix, or zero prompt and completion prices with no per-request or per-image price.
- **Reasoning** means a `reasoning` object, or `reasoning` / `include_reasoning` / `reasoning_effort` in
  `supported_parameters`. Effort levels come from `reasoning.supported_efforts`. When that field is null,
  the model publishes no allowlist and accepts any effort level.
- **Capabilities**: tools (`tools`), structured outputs (`structured_outputs` or `response_format`), native web
  search (`web_search_options`), prompt caching (`pricing.input_cache_read` present), plus the input and output modalities.
- **Provider** is the id prefix (`author/model` → `author`).

### How sure we are about the schema

- **Verified:** field names, units and query parameters come from the official `@openrouter/sdk` v1.4.25
  (generated from OpenRouter's OpenAPI spec). This includes `pricing.*` as USD per token,
  `image_output` as USD per output image, the `reasoning` object, `benchmarks.artificial_analysis`, and the
  `/images/models` and `/videos/models` response shapes.
- **Not verified against live data:** this repo was built in an environment that could not reach
  openrouter.ai. Tests run against a synthetic fixture in the documented wire format (`tests/fixtures.mjs`;
  the vendors and numbers are made up).
- **Unknown:**
  - **Video pricing SKUs.** `pricing_skus` is an open key→price map, and the units (per second, per video, per resolution) are in the key names. The app shows the cheapest SKU together with its name, not a normalized price.
  - **Auth on image and video listings.** Whether those two endpoints require an API key is not documented in the SDK. If they fail, the rest of the dashboard still loads and the status line says which catalog is missing.
  - **Browser CORS.** Whether the browser can call OpenRouter directly. `npm start` makes this irrelevant.

## Development

```sh
npm test             # unit tests for the data layer (node:test)
npm install          # only needed for the e2e test (installs Playwright)
npm run test:e2e     # headless Chromium: all data paths, every card, tooltips, filters, dark mode, phone width
```

Set `PLAYWRIGHT_CHROMIUM_PATH` to use an existing Chromium binary. Screenshots are written to `test-results/`.

```
index.html, styles.css   page shell and design tokens (light/dark)
src/api.js               fetching with source fallback, snapshot parsing
src/data.js              pure normalization and aggregation (unit-tested)
src/charts.js            small SVG chart kit: bars, columns, scatter, heatmap, tooltip
src/app.js               filters, cards, tables, exports
server.mjs               static server + allowlisted OpenRouter proxy
scripts/snapshot.mjs     writes data/snapshot.json
```
