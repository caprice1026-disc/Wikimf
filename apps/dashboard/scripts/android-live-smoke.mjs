// Read-only end of the emulator -> real Wikipedia -> API/PG -> Dashboard check.
// The fixture is an ignored local QA session, never a real user's credentials.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const fixturePath = fileURLToPath(new URL('../../../.tmp/backend-live-smoke.json', import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
assert.equal(new URL(fixture.dashboard_origin).hostname, 'localhost');
assert.equal(new URL(fixture.api_origin).port, '8002');
const output = new URL('../output/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  await context.addCookies([fixture.cookie]);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => {
    if (response.url().includes('/api/v1/') && response.status() >= 500) errors.push(`HTTP ${response.status()}`);
  });
  const request = async path => {
    const response = await context.request.get(`${fixture.dashboard_origin}/api/v1${path}`);
    assert.equal(response.status(), 200, path);
    return response.json();
  };
  assert.equal((await request('/me')).user_id, fixture.user_id);
  const activities = (await request('/me/activities?source=android_reader&limit=100')).items;
  const articles = (await request('/me/articles?limit=100')).items;
  const measured = [];
  for (const [wiki, pageId] of [['jawiki', 2460204], ['enwiki', 9228]]) {
    const record = articles.find(item => item.article.wiki === wiki && item.article.page_id === pageId);
    assert.ok(record, `${wiki} real article in library`);
    const article = record.article;
    const rows = activities.filter(row => row.source === 'android_reader' && row.article_id === record.article_id && row.active_ms >= 10000 && !row.quarantined);
    assert.ok(rows.length, `${wiki} native reading accepted above 10 seconds`);
    await page.goto(`${fixture.dashboard_origin}/app/library?wiki=${wiki}`);
    await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[role=alert]').count(), 0);
    assert.ok(await page.getByRole('link', { name: article.title, exact: true }).count(), `${wiki} actual title on screen`);
    measured.push({ wiki, page_id: pageId, activities: rows.length, active_ms: rows.reduce((total, row) => total + row.active_ms, 0) });
  }
  await page.goto(`${fixture.dashboard_origin}/app/activity?source=android_reader`);
  await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  await page.screenshot({ path: fileURLToPath(new URL('android-live-dashboard.png', output)), fullPage: true });
  assert.deepEqual(errors, []);
  const report = { result: 'pass', verified_at: new Date().toISOString(), identity: 'synthetic QA identity; real provider OAuth not tested', metadata: 'real MediaWiki; isolated live QA database without synthetic readings', transport: 'Android emulator -> FastAPI -> PostgreSQL -> installed Chrome Dashboard', readings: measured, browser_errors: 0 };
  await writeFile(new URL('android-live-dashboard.json', output), JSON.stringify(report, null, 2) + '\n');
  console.log('Android real Wikipedia -> Dashboard: PASS (JA/EN native readings, real page IDs, actual API and Chrome).');
} finally { await browser.close(); }
