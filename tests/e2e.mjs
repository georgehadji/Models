// End-to-end smoke test in headless Chromium against the synthetic fixture.
// Covers the three data paths (direct API, local proxy, nothing reachable),
// rendering of every card, hover tooltips, table toggles, filters, dark mode
// and the no-horizontal-scroll rule at phone width.
// Usage: npm run test:e2e  (requires the `playwright` package and a Chromium build)

import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { makeCatalog } from './fixtures.mjs';

const OUT = new URL('../test-results/', import.meta.url).pathname;
const catalog = makeCatalog();
const bodyFor = (path) =>
  path.startsWith('/videos/models') ? catalog.videos : path.startsWith('/images/models') ? catalog.images : catalog.models;

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
    cwd: new URL('..', import.meta.url).pathname,
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

try {
  // 1. Direct API path: full render.
  {
    const { page, errors } = await openPage(browser, app.url, { direct: true });
    await page.waitForSelector('#card-releases svg');
    assert.match(await page.textContent('#status'), new RegExp(`${total} models · OpenRouter API`));

    const cards = await page.$$eval('.card', (els) =>
      els.map((el) => ({ id: el.id, svg: !!el.querySelector('.chart svg'), empty: el.querySelector('.chart .empty')?.textContent || null })),
    );
    assert.ok(cards.length >= 20, `expected 20+ cards, got ${cards.length}`);
    const blank = cards.filter((c) => !c.svg);
    assert.deepEqual(blank, [], `cards without a chart: ${JSON.stringify(blank)}`);

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
    await page.click('#card-cap-coverage .card-head button');
    assert.ok(await page.isVisible('#card-cap-coverage table'));
    assert.ok(!(await page.isVisible('#card-cap-coverage .chart')));

    // Filters scope the KPIs.
    const before = await page.textContent('#kpis .kpi-value');
    await page.check('input[name="cap"][value="reasoning"]');
    await page.waitForFunction((b) => document.querySelector('#kpis .kpi-value').textContent !== b, before);
    const reasoningOnly = Number(await page.textContent('#kpis .kpi-value'));
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
