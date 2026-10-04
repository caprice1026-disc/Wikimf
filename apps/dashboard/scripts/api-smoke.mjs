// Real HTTP + Backend browser integration. The root QA process provides an isolated synthetic user/session.
// Cookie values, tokens, private titles, and IDs are never printed or written to this test's report.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const fixturePath = process.env.DASHBOARD_API_FIXTURE || fileURLToPath(new URL('../../../.tmp/backend-smoke.json', import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
const base = fixture.dashboard_origin;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addCookies([fixture.cookie]);
const page = await context.newPage();
const problems = [], failures = [];
const deviceLabel = 'Dashboard browser QA ' + Date.now();
let crossSource = null;
page.on('pageerror', error => problems.push(error.message));
page.on('response', response => { if (response.status() >= 500 && response.url().includes('/api/v1/')) failures.push(response.status()); });

try {
  const meResponse = await context.request.get(`${base}/api/v1/me`);
  assert.equal(meResponse.status(), 200);
  const me = await meResponse.json();
  assert.equal(me.user_id, fixture.user_id);
  assert.ok(me.csrf_token);
  assert.ok(Object.hasOwn(me, 'recent_auth_until'), 'actual API provides authentication freshness');

  await page.goto(`${base}/app`);
  await page.getByRole('heading', { name: 'Recent reading', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  await mkdir(new URL('../output/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../output/redesign-overview-real-api-desktop.png', import.meta.url)), fullPage: true });

  await page.goto(`${base}/app/library?wiki=jawiki&sort=active_ms`);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  assert.equal(await page.getByRole('combobox', { name: /言語/ }).inputValue(), 'jawiki');
  const libraryResponse = await context.request.get(`${base}/api/v1/me/articles?wiki=jawiki&sort=active_ms&limit=50`);
  assert.equal(libraryResponse.status(), 200);
  const library = await libraryResponse.json();
  assert.ok(Array.isArray(library.items));
  if (library.items.length) {
    await page.goto(`${base}/app/articles/${library.items[0].article_id}`);
    await page.getByRole('heading', { name: '読書状態を変更', exact: true }).waitFor();
    await page.waitForLoadState('networkidle');
    assert.equal(await page.locator('[role=alert]').count(), 0);
    await page.getByRole('button', { name: 'この記事を履歴から削除' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
    const check = await context.request.get(`${base}/api/v1/me/articles/${library.items[0].article_id}`);
    assert.equal(check.status(), 200, 'cancel preserves real article history');
  }

  await page.goto(`${base}/app/activity?source=chrome_extension`);
  await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  if (process.env.DASHBOARD_REQUIRE_BOTH_SOURCES === '1') {
    const activitiesResponse = await context.request.get(`${base}/api/v1/me/activities?limit=100`);
    assert.equal(activitiesResponse.status(), 200);
    const activities = (await activitiesResponse.json()).items;
    crossSource = {};
    for (const [source, label] of [['android_reader', 'Android'], ['chrome_extension', 'Chrome']]) {
      const rows = activities.filter(item => item.source === source && item.active_ms >= 10000);
      assert.ok(rows.length > 0, `same owner has qualified ${source} readings`);
      crossSource[source] = { activities: rows.length, active_ms: rows.reduce((total, row) => total + row.active_ms, 0) };
      await page.goto(`${base}/app/activity?source=${source}`);
      await page.getByRole('heading', { name: 'Activity', exact: true }).waitFor();
      await page.waitForLoadState('networkidle');
      assert.equal(await page.locator('.reading-row').count(), rows.length);
      assert.ok((await page.locator('.reading-meta').allTextContents()).every(text => text.includes(label)));
    }
  }
  await page.goto(`${base}/app/stats?period=30d&timezone=America%2FNew_York`);
  await page.getByRole('heading', { name: '日ごとの読書時間', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  await page.goto(`${base}/app/achievements`);
  await page.getByRole('heading', { name: 'これまでの節目', exact: true }).waitFor();

  await page.goto(`${base}/app/settings/privacy`);
  await page.getByRole('heading', { name: 'Visibility', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('[role=alert]').count(), 0);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false);
  await page.screenshot({ path: fileURLToPath(new URL('../output/redesign-privacy-real-api-phone.png', import.meta.url)), fullPage: true });

  // Create our own grant without changing the shared QA user's collection or records.
  const grantResponse = await fetch(`${fixture.api_origin}/api/v1/device-links`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: 'chrome_extension', display_name: deviceLabel }),
  });
  assert.equal(grantResponse.status, 200);
  const grant = await grantResponse.json();
  await page.goto(`${base}/link-device/${grant.link_id}`);
  await page.getByRole('heading', { name: deviceLabel, exact: true }).waitFor();
  const webGrantResponse = await context.request.get(`${base}/api/v1/device-links/${grant.link_id}`);
  assert.equal(webGrantResponse.status(), 200);
  assert.equal(Object.hasOwn(await webGrantResponse.json(), 'user_code'), false, 'Web grant cannot reveal the device confirmation code');
  assert.equal(await page.getByLabel('端末に表示された確認コード').inputValue(), '');
  await page.getByLabel('端末に表示された確認コード').fill(grant.user_code);
  await page.getByRole('button', { name: 'この端末を承認する' }).click();
  await page.getByRole('heading', { name: '端末の連携を承認しました。', exact: true }).waitFor();
  const exchangeResponse = await fetch(`${fixture.api_origin}/api/v1/device-links/${grant.link_id}/exchange`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ device_secret: grant.device_secret }),
  });
  assert.equal(exchangeResponse.status, 200);
  const exchange = await exchangeResponse.json();
  assert.equal(exchange.user_id, fixture.user_id);
  await page.goto(`${base}/app/settings/account`);
  const ownDevice = page.locator('.management-row').filter({ hasText: deviceLabel });
  await ownDevice.getByRole('button', { name: '端末を解除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '解除する', exact: true }).click();
  await ownDevice.getByRole('button', { name: '解除済み', exact: true }).waitFor();
  const rejected = await fetch(`${fixture.api_origin}/api/v1/me`, { headers: { Authorization: `Bearer ${exchange.token}` } });
  assert.equal(rejected.status, 401, 'revoked own device is rejected by actual API');

  await page.goto(`${base}/app/library`);
  await page.getByRole('heading', { name: 'Library', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false);
  assert.deepEqual(problems, []);
  assert.deepEqual(failures, []);
  await writeFile(new URL('../output/redesign-real-api-browser-smoke.json', import.meta.url), JSON.stringify({ result: 'pass', verified_at: new Date().toISOString(), data: 'isolated synthetic QA user', transport: 'real HTTP API with provided PostgreSQL QA server', verified: ['cookie-session-csrf-read', 'overview', 'server-library-filter-sort', 'article-record-delete-cancel', 'activity-source-filter', 'statistics-period-timezone', 'achievements', 'privacy-controls', 'explicit-grant-approval', 'web-grant-code-not-disclosed', 'recent-auth-until-contract', 'native-grant-exchange', 'own-device-revocation', 'revoked-token-rejected', '390px-no-overflow', ...(crossSource ? ['same-owner-android-chrome-visible-readings'] : [])], cross_source: crossSource, browserErrors: 0, serverErrors: 0 }, null, 2));
  console.log(`Dashboard actual API browser smoke: PASS (${crossSource ? 16 : 15} checks; synthetic QA identity/metadata, real HTTP/API).`);
} finally { await browser.close(); }
