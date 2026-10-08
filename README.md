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

## Pick for a project

The first section recommends models for a type of project. Every chart in it names specific models.

1. **Presets**: Coding agent, Agentic workflow, Chat assistant, Long-document RAG, Bulk extraction,
   Website / UI and Vision. Each sets a quality metric (Coding, Agentic or Intelligence index, or the
   Design Arena Elo for website and UI-component work), hard requirements, weights and a typical task
   size. Image and video generation jump to their own sections, because those catalogs have no quality
   benchmark.
2. **Requirements and weights**: required capabilities, minimum context, maximum blended price,
   quality / cost / context weights, tokens per task and estimated reasoning tokens per effort level.
   Settings are remembered in this browser. The filter bar applies too.
3. **Three picks, each with a fallback**:
   - *Best quality*: the highest score on the preset's metric.
   - *Lowest cost*: the cheapest per task among models at or above the median score.
   - *Best value*: the highest weighted score among models that cost at least as much as the lowest-cost
     pick.

   Each fallback is the next model in the same ranking from a different provider, preferring one close
   in quality. A copyable `"models": [pick, fallback]` field is ready for OpenRouter's model fallbacks.
4. **Cost by reasoning effort**: a table of estimated $ per 1,000 tasks for each shortlisted model at
   every effort it accepts, with its default outlined.
5. **Effort curves** for the picks and fallbacks, and a **quality vs cost** scatter of every candidate
   with the Pareto frontier.
6. **Capabilities of the shortlist**, compared at each model's default effort, at one effort for all
   models (nearest supported level when a model lacks it), or at a different effort per model.

Cost per task = input tokens × input price + output tokens × output price + reasoning tokens ×
reasoning price (the output price when no separate reasoning price is listed).

## What's charted

Every card below shows named models: rankings, scatters with model tooltips and model × feature grids.

| Section | Charts |
|---|---|
| Pricing | Cheapest and most expensive models (input vs output $/1M), cheapest per task at default effort, input vs output price scatter, price vs context scatter (log–log, reasoning vs non-reasoning) |
| Capabilities | Model × capability and modality grid (top models by Intelligence index) |
| Context | Largest context windows with max output tokens, cheapest models with a 1M+ context |
| Reasoning | Model × effort-level grid with each default marked, cost per task at lowest / default / highest effort |
| Benchmarks | Artificial Analysis Intelligence / Coding / Agentic indices, intelligence vs price scatter |
| Timeline | Release date vs Intelligence index, one dot per model |
| Image generation | Price per generated image, token prices of image-output models, Image API parameters matrix |
| Video generation | Max duration, lowest listed pricing SKU, resolution and feature matrix |
| Explorer | Sortable table of every model with CSV export |

One filter row scopes every chart and table: search, provider, input modality, output modality,
free/paid, required capabilities (reasoning, tools, image input, structured outputs) and ranking size.
Each chart card has a **Table** toggle that shows the same data as a table, and supports hover and keyboard tooltips.
Light and dark themes follow the OS setting or the **Theme** button.

### Data limits

- The API publishes one benchmark score per model and does not say at which reasoning effort it was measured.
- It lists which efforts a model accepts and its default, but not how many tokens each effort spends,
  so reasoning tokens per effort are editable estimates. Reasoning models without an effort list are
  assumed to accept low / medium / high. Optional reasoning counts as off unless the API says it is on
  by default.
- Picks leave out `:batch`, `:free` and other variants (Bulk extraction allows `:batch`), free models,
  models without text output and models without a score on the preset's metric. The section reports
  how many were left out for each reason.

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
npm test             # unit tests for the data layer and recommendations (node:test)
npm install          # only needed for the e2e test (installs Playwright)
npm run test:e2e     # headless Chromium: all data paths, pick section, every card, tooltips, filters, dark mode, phone width
```

Set `PLAYWRIGHT_CHROMIUM_PATH` to use an existing Chromium binary. Screenshots are written to `test-results/`.

```
index.html, styles.css   page shell and design tokens (light/dark)
pick.css                 styles for the Pick for a project section
src/api.js               fetching with source fallback, snapshot parsing
src/data.js              pure normalization, filtering and ranking helpers (unit-tested)
src/recommend.js         pure presets, cost per task by effort, tiers, fallbacks, frontier (unit-tested)
src/pick-controls.js     pick section form state (saved in localStorage)
src/pick.js              pick section rendering
src/cards.js             card definitions for the sections below the pick section
src/charts.js            small SVG chart kit: bars, scatter, lines, heatmap, tooltip
src/app.js               filters, card rendering, tables, exports
server.mjs               static server + allowlisted OpenRouter proxy
scripts/snapshot.mjs     writes data/snapshot.json
```
