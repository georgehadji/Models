// End-to-end smoke test in headless Chromium against the synthetic fixture.
// Covers the three data paths (direct API, local proxy, nothing reachable),
// the "Pick for a project" section (tiers, fallbacks, effort table, effort
// compare control), rendering of every card, hover tooltips, table toggles,
// filters, dark mode and the no-horizontal-scroll rule at phone width.
// Usage: npm run test:e2e  (requires the `playwright` package and a Chromium build)

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeCatalog } from './fixtures.mjs';
import * as D from '../src/data.js';
import * as R from '../src/recommend.js';

const OUT = fileURLToPath(new URL('../test-results/', import.meta.url));
const catalog = makeCatalog();
// Synthetic per-provider speed: median p50 latency 1,500 ms, median throughput 60 tok/s.
const endpointsBody = {
  data: {
    endpoints: [
      { provider_name: 'Fast Co', latency_last_30m: { p50: 1200, p90: 2400 }, throughput_last_30m: { p50: 70 } },
      { provider_name: 'Slow Co', latency_last_30m: { p50: 1800 }, throughput_last_30m: 50 },
    ],
  },
};
const bodyFor = (path) =>
  path.endsWith('/endpoints')
    ? endpointsBody
    : path.startsWith('/videos/models')
      ? catalog.videos
      : path.startsWith('/images/models')
        ? catalog.images
        : catalog.models;

function fakeUpstream() {
  const srv = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(bodyFor(path)));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}

function startApp(upstream) {
  const child = spawn(process.execPath, ['server.mjs', '--port', '0'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, OPENROUTER_BASE: upstream },
  });
  return new Promise((resolve, reject) => {
    child.stdout.on('data', (d) => {
      const m = String(d).match(/http:\/\/\S+/);
      if (m) resolve({ url: m[0], stop: () => child.kill() });
    });
    child.on('exit', (code) => reject(new Error(`server exited ${code}`)));
  });
}

async function openPage(browser, url, { direct, viewport = { width: 1280, height: 900 }, colorScheme = 'light' }) {
  const page = await browser.newPage({ viewport, colorScheme });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource/.test(m.text()) && errors.push(m.text()));
  await page.route('https://openrouter.ai/api/v1/**', (route) => {
    if (!direct) return route.abort();
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    return route.fulfill({ json: bodyFor(path), headers: { 'access-control-allow-origin': '*' } });
  });
  await page.goto(url);
  return { page, errors };
}

const exec = process.env.PLAYWRIGHT_CHROMIUM_PATH;
const browser = await chromium.launch(exec ? { executablePath: exec } : {});
const upstream = await fakeUpstream();
const app = await startApp(`http://127.0.0.1:${upstream.address().port}`);
const deadApp = await startApp('http://127.0.0.1:9');
await mkdir(OUT, { recursive: true });
const total = catalog.models.data.length;

// Picks the app should show for the default preset, computed with the same pure modules.
function expectedTiers() {
  const p = R.PRESETS[0];
  const models = catalog.models.data.map(D.normalizeModel);
  const a = { input: p.task.input, output: p.task.output, reasoningTokens: R.DEFAULT_REASONING_TOKENS };
  const { list } = R.candidates(models, { ...p }, a);
  return R.rankTiers(R.score(list, p.weights)).filter((t) => t.pick);
}

try {
  // 1. Direct API path: full render.
  {
    const { page, errors } = await openPage(browser, app.url, { direct: true });
    await page.waitForSelector('#card-releases svg');
    assert.match(await page.textContent('#status'), new RegExp(`${total} models · OpenRouter API`));

    // Section cards only: the pick section's cards hold tables and tier cards, not .chart svgs.
    const cards = await page.$$eval('.grid[data-section] .card', (els) =>
      els.map((el) => ({ id: el.id, svg: !!el.querySelector('.chart svg'), empty: el.querySelector('.chart .empty')?.textContent || null })),
    );
    assert.equal(cards.length, 19, `expected 19 section cards, got ${cards.length}`);
    const blank = cards.filter((c) => !c.svg);
    assert.deepEqual(blank, [], `cards without a chart: ${JSON.stringify(blank)}`);

    // Pick section: one card per tier with a pick, each naming a fallback, plus the effort table.
    const tiers = expectedTiers();
    assert.equal(await page.locator('#pick-tiers .tier').count(), tiers.length);
    for (const [i, t] of tiers.entries()) {
      const card = page.locator('#pick-tiers .tier').nth(i);
      assert.equal(await card.locator('.tier-name').textContent(), t.pick.m.name);
      if (t.fallback) assert.equal(await card.locator('.fallback .name').textContent(), t.fallback.m.name);
    }
    if (tiers.length) {
      assert.ok((await page.locator('#pick-effort-table td.cost-cell.default').count()) >= tiers.length);
      assert.ok(await page.isVisible('#pick-curves svg'));
      assert.ok(await page.isVisible('#pick-scatter svg'));
      // Compare control: all at "low" puts every row's effort select on low or its nearest level.
      await page.selectOption('#pick-compare', 'low');
      const efforts = await page.$$eval('#pick-caps tbody select', (s) => s.map((x) => x.value));
      assert.ok(efforts.length > 0 && efforts.every((e) => ['none', 'minimal', 'low', 'medium'].includes(e)), efforts.join(','));
      await page.selectOption('#pick-compare', 'default');

      // Latency/throughput appear once an API key is entered (dummy key; the upstream here is fake).
      assert.match(await page.textContent('#pick-summary'), /API key/);
      await page.click('.api-key summary');
      await page.fill('#api-key', 'test-key');
      await page.press('#api-key', 'Tab');
      await page.waitForFunction(() => document.querySelector('#pick-caps tbody td:nth-child(7)')?.textContent === '1.5 s');
      assert.equal(await page.textContent('#pick-caps tbody tr:first-child td:nth-child(8)'), '60 tok/s');
      assert.match(await page.textContent('#pick-tiers .tier .why'), /Latency 1\.5 s · throughput 60 tok\/s/);
      assert.match(await page.getAttribute('#pick-caps tbody td:nth-child(7)', 'title'), /fastest: Fast Co 1\.2 s/);
      await page.fill('#api-key', '');
      await page.press('#api-key', 'Tab');
      await page.click('.api-key summary');
    }

    // Hover a bar row → tooltip with the model's prices.
    await page.hover('#card-price-low .row');
    assert.ok(await page.isVisible('.tooltip.visible'));
    assert.match(await page.textContent('.tooltip'), /Input/);

    // Scatter nearest-point hover.
    await page.locator('#card-price-context .overlay').scrollIntoViewIfNeeded();
    const dot = await page.locator('#card-price-context circle.dot').first().boundingBox();
    await page.mouse.move(dot.x + dot.width / 2 + 3, dot.y + dot.height / 2 + 3, { steps: 2 });
    assert.ok(await page.isVisible('.tooltip.visible'));

    // Table toggle.
    await page.click('#card-cap-models .card-head button');
    assert.ok(await page.isVisible('#card-cap-models table'));
    assert.ok(!(await page.isVisible('#card-cap-models .chart')));

    // Filters scope the explorer (and every card).
    const rowsSel = '#explorer-table tbody tr';
    const before = await page.locator(rowsSel).count();
    await page.check('input[name="cap"][value="reasoning"]');
    await page.waitForFunction(([sel, b]) => document.querySelectorAll(sel).length !== b, [rowsSel, before]);
    const reasoningOnly = await page.locator(rowsSel).count();
    const expected = catalog.models.data.filter(
      (m) => m.reasoning || (m.supported_parameters || []).includes('reasoning'),
    ).length;
    assert.equal(reasoningOnly, expected);
    await page.click('#f-reset');

    // Explorer sorting and row count.
    assert.equal(await page.locator('#explorer-table tbody tr').count(), total);
    await page.click('#explorer-table th button:has-text("Context")');
    assert.equal(await page.textContent('#explorer-table tbody tr:first-child td:nth-child(3)'), '8.2K');

    await page.screenshot({ path: `${OUT}desktop-light.png`, fullPage: true });
    await page.click('#theme');
    assert.equal(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.screenshot({ path: `${OUT}desktop-dark.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }

  // 2. Phone width: no horizontal page scroll.
  {
    const { page, errors } = await openPage(browser, app.url, { direct: true, viewport: { width: 375, height: 800 } });
    await page.waitForSelector('#card-releases svg');
    const overflow = await page.evaluate(() => document.scrollingElement.scrollWidth - window.innerWidth);
    assert.ok(overflow <= 0, `page scrolls horizontally by ${overflow}px`);
    await page.screenshot({ path: `${OUT}mobile.png`, fullPage: true });
    assert.deepEqual(errors, []);
    await page.close();
  }

  // 3. Direct API blocked → local proxy.
  {
    const { page, errors } = await openPage(browser, app.url, { direct: false });
    await page.waitForSelector('#card-releases svg');
    assert.match(await page.textContent('#status'), /local proxy/);
    assert.deepEqual(errors, []);
    await page.close();
  }

  // 4. Nothing reachable → actionable error, then JSON import recovers.
  {
    const { page } = await openPage(browser, deadApp.url, { direct: false });
    await page.waitForSelector('#error:not([hidden])');
    assert.match(await page.textContent('#error'), /npm start/);
    await page.setInputFiles('#import', {
      name: 'models.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(catalog.models)),
    });
    await page.waitForSelector('#card-releases svg');
    assert.match(await page.textContent('#status'), /imported models\.json/);
    assert.ok(await page.isHidden('#error'));
    await page.close();
  }

  console.log('e2e: all checks passed; screenshots in test-results/');
} finally {
  app.stop();
  deadApp.stop();
  upstream.close();
  await browser.close();
}
