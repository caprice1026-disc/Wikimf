// Deterministic, synthetic API fixtures. This checks browser behavior, not live OAuth or server isolation.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const base = process.env.DASHBOARD_URL || 'http://127.0.0.1:5173';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const problems = [];
page.on('pageerror', error => problems.push(error.message));
const now = new Date().toISOString();
const article = { article_id: '40000000-0000-4000-8000-000000000001', wiki: 'jawiki', page_id: 12345, title: '量子力学 — これはブラウザ検証用の合成データです', canonical_url: 'https://ja.wikipedia.org/wiki/量子力学' };
const article2 = { ...article, article_id: '40000000-0000-4000-8000-000000000002', wiki: 'enwiki', title: 'Elliptic curve cryptography and a deliberately long synthetic title for responsive verification', canonical_url: 'https://en.wikipedia.org/wiki/Elliptic_curve_cryptography' };
const activity = { article, article_id: article.article_id, session_id: 'session-fixture-1', source: 'android_reader', session_started_at: now, state: 'partial', active_ms: 480000, estimated_read_chars: 2000, coverage: 0.5, evidence: 'inferred', judgement_policy_version: 'reading-v1', pending_sync: false, quarantined: false };
const record = { article, article_id: article.article_id, effective_state: 'partial', inferred_state: 'partial', manual_state: null, evidence: 'inferred', active_ms: 480000, estimated_read_chars: 2000, coverage: 0.5, last_read_at: now, activity_count: 1, pending_sync: false, activities: [activity] };
let authenticated = false, records = [structuredClone(record), { ...structuredClone(record), article: article2, article_id: article2.article_id }];
let activities = [activity, { ...activity, article: article2, article_id: article2.article_id, session_id: 'session-fixture-2', source: 'chrome_extension' }];
let privacy = { collection_enabled: false, consent_version: null, profile_public: false, publish_total_time: false, publish_achievements: false, timezone: 'Asia/Tokyo', display_name: 'Reader fixture' };
let devices = [{ device_id: 'device-fixture-1', display_name: 'Pixel fixture', source: 'android_reader', created_at: now, expires_at: now, last_used_at: now, revoked: false }];
const mutations = [], requests = [];
let failActivities = false;
const earned = [{ id: 'first-reading', name: 'First page', description: '検証用の節目', earned: true, progress: 1, target: 1 }];

await page.route('**/api/v1/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname.replace('/api/v1', '');
  const method = request.method();
  requests.push({ path, method, query: url.search });
  let status = 200, body = {};
  if (method !== 'GET') {
    mutations.push({ path, method, body: request.postDataJSON(), csrf: request.headers()['x-csrf-token'] });
    assert.equal(request.headers()['x-csrf-token'], 'synthetic-csrf', 'management mutation carries CSRF');
  }
  if (path.startsWith('/profiles/')) body = { user_id: 'public-fixture', display_name: 'Public fixture', active_ms: 480000, achievements: earned };
  else if (!authenticated) { status = 401; body = { error: { code: 'authentication_required' } }; }
  else if (path === '/me') {
    if (method === 'DELETE') { assert.equal(request.postDataJSON().confirmation, 'DELETE'); authenticated = false; records = []; activities = []; body = { deleted: true }; }
    else body = { user_id: 'fixture-user', display_name: privacy.display_name, csrf_token: 'synthetic-csrf', timezone: privacy.timezone, recording_epoch: 1, collection_enabled: privacy.collection_enabled };
  }
  else if (path === '/me/privacy') { if (method === 'PATCH') { assert.equal(Object.values(request.postDataJSON()).includes(null), false, 'PATCH omits unset consent instead of sending null'); privacy = { ...privacy, ...request.postDataJSON() }; } body = privacy; }
  else if (path === '/me/stats') body = {
    library: { recorded_article_count: records.length, qualified_article_count: records.length, state_counts: { viewed: 0, partial: records.filter(item => item.effective_state === 'partial').length, completed: records.filter(item => item.effective_state === 'completed').length }, completed_inferred_count: 0, completed_self_reported_count: records.filter(item => item.manual_state === 'completed').length },
    activity: { activity_count: activities.length, qualified_article_count: records.length, active_ms: activities.length * 480000, estimated_unique_read_chars: records.length * 2000 },
    daily: [{ date: now.slice(0, 10), active_ms: activities.length * 480000 }], by_wiki: { jawiki: { active_ms: 480000, activity_count: 1 }, enwiki: { active_ms: 480000, activity_count: 1 } }, pending_recalculation: false, as_of: now, timezone: url.searchParams.get('timezone') || 'Asia/Tokyo',
  };
  else if (path === '/me/activities') {
    if (failActivities) { status = 503; body = { error: { code: 'temporarily_unavailable' } }; }
    else body = { items: activities.filter(item => !url.searchParams.get('source') || item.source === url.searchParams.get('source')), next_cursor: null };
  }
  else if (path === '/me/articles') body = { items: records.filter(item => (!url.searchParams.get('state') || item.effective_state === url.searchParams.get('state')) && (!url.searchParams.get('query') || item.article.title.includes(url.searchParams.get('query')))), next_cursor: null };
  else if (path.endsWith('/state')) {
    const item = records.find(item => path.includes(item.article_id));
    item.manual_state = method === 'PUT' ? request.postDataJSON().state : null;
    item.effective_state = item.manual_state || item.inferred_state;
    body = item;
  }
  else if (path.match(/^\/me\/articles\/[^/]+\/history$/)) { records = records.filter(item => !path.includes(item.article_id)); activities = activities.filter(item => !path.includes(item.article_id)); body = { deleted: true, recording_epoch: 1 }; }
  else if (path.startsWith('/me/articles/')) { body = records.find(item => path.endsWith(item.article_id)); if (!body) { status = 404; body = { error: { code: 'article_not_found' } }; } }
  else if (path === '/me/achievements') body = { items: earned };
  else if (path === '/me/identities') body = { items: [{ provider: 'google', linked_at: now }] };
  else if (path === '/me/devices') body = { items: devices };
  else if (path.startsWith('/me/devices/')) { devices[0].revoked = true; body = { revoked: true }; }
  else if (path.endsWith('/approve')) { assert.equal(request.postDataJSON().user_code, 'MATCH-1234'); body = { approved: true }; }
  else if (path.startsWith('/device-links/')) body = { link_id: 'link-fixture', display_name: 'Chrome fixture', source: 'chrome_extension', user_code: 'MATCH-1234', scopes: ['reading:write', 'reading:read', 'profile:read'], expires_at: now, approved: false };
  else if (path === '/me/history') { records = []; activities = []; body = { deleted: true, recording_epoch: 2 }; }
  else if (path === '/me/export') body = { export_version: 1, user: { display_name: 'Reader fixture' }, articles: records };
  else { status = 404; body = { error: { code: 'fixture_route_missing' } }; }
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
});

try {
  await mkdir(new URL('../output/', import.meta.url), { recursive: true });
  await page.goto(`${base}/app`);
  await page.getByRole('heading', { name: '続きは、あなたのページで。' }).waitFor();
  assert.ok(await page.getByRole('link', { name: /Google で続ける/ }).getAttribute('href'));
  authenticated = true;
  await page.goto(`${base}/app`);
  await page.getByRole('heading', { name: 'Reader fixture' }).waitFor();
  await page.getByRole('link', { name: article.title }).waitFor();
  await page.screenshot({ path: new URL('../output/overview-desktop-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false);

  await page.goto(`${base}/app/library`);
  await page.getByRole('link', { name: article.title }).waitFor();
  await page.getByRole('searchbox').fill('量子');
  const searchResponse = page.waitForResponse(response => response.url().includes('/me/articles?') && response.url().includes('query='));
  await page.getByRole('button', { name: '検索', exact: true }).click();
  await page.waitForURL(/query=/);
  await searchResponse;
  assert.ok(requests.some(item => item.path === '/me/articles' && item.query.includes('query=')));
  await page.getByRole('link', { name: article.title }).click();
  await page.getByRole('radio', { name: '✓ 読了' }).check();
  await page.getByRole('button', { name: '手動設定を保存' }).click();
  await page.getByText('手動設定', { exact: true }).waitFor();
  assert.equal(records[0].manual_state, 'completed');
  assert.equal(records[0].active_ms, 480000);
  await page.getByRole('button', { name: '自動推定に戻す' }).click();
  await page.getByText('自動推定', { exact: true }).first().waitFor();
  assert.equal(records[0].manual_state, null);
  await page.getByRole('button', { name: 'この記事を履歴から削除' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'キャンセル' }).click();
  assert.equal(records.length, 2);
  await page.getByRole('button', { name: 'この記事を履歴から削除' }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await page.waitForURL(/\/app\/library$/);
  await page.reload();
  await page.getByRole('link', { name: article2.title }).waitFor();
  assert.equal(await page.getByRole('link', { name: article.title }).count(), 0);

  await page.goto(`${base}/app/settings/privacy`);
  await page.getByRole('switch', { name: /総読書時間を公開/ }).check();
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await page.getByText('プライバシー設定を保存しました。').waitFor();
  assert.equal(privacy.collection_enabled, false);
  assert.equal(privacy.consent_version, null);
  await page.getByRole('switch', { name: /全端末からのクラウド記録/ }).check();
  await page.getByRole('button', { name: '設定を保存', exact: true }).click();
  await page.getByText('プライバシー設定を保存しました。').waitFor();
  assert.equal(privacy.consent_version, 'privacy-v1');
  assert.equal(privacy.publish_total_time, true);
  assert.equal(privacy.profile_public, false);
  assert.equal(privacy.publish_achievements, false);
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /JSON をダウンロード/ }).click();
  assert.ok((await download).suggestedFilename().endsWith('.json'));

  await page.goto(`${base}/app/settings/account`);
  await page.getByRole('button', { name: '解除', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '解除', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '端末を解除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '解除する', exact: true }).click();
  await page.getByRole('button', { name: '解除済み', exact: true }).waitFor();

  await page.goto(`${base}/link-device/link-fixture`);
  await page.getByRole('heading', { name: 'Chrome fixture' }).waitFor();
  assert.equal(mutations.filter(item => item.path.endsWith('/approve')).length, 0);
  await page.getByLabel('端末に表示された確認コード').fill('MATCH-1234');
  await page.getByRole('button', { name: 'この端末を承認する' }).click();
  await page.getByRole('heading', { name: '端末の連携を承認しました。' }).waitFor();

  await page.goto(`${base}/app/stats?timezone=Invalid%2FZone&period=7d`);
  await page.getByRole('heading', { name: '日ごとの読書時間' }).waitFor();
  assert.ok(requests.some(item => item.path === '/me/stats' && item.query.includes('timezone=Asia%2FTokyo')));
  await page.getByLabel('タイムゾーン').selectOption('America/New_York');
  await page.waitForURL(/America%2FNew_York/);
  await page.waitForLoadState('networkidle');

  const publicStart = requests.length;
  await page.goto(`${base}/u/public-fixture`);
  await page.getByRole('heading', { name: 'Public fixture' }).waitFor();
  assert.equal(requests.slice(publicStart).some(item => item.path.startsWith('/me')), false, 'public page requests no private API');
  assert.equal(await page.getByRole('link', { name: article2.title }).count(), 0);

  failActivities = true;
  await page.goto(`${base}/app`);
  await page.getByRole('alert').waitFor();
  await page.getByRole('heading', { name: 'Last 7 days' }).waitFor();
  failActivities = false;
  await page.getByRole('button', { name: '再試行', exact: true }).click();
  await page.getByRole('link', { name: article2.title }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('../output/overview-phone-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false, 'phone overview has no horizontal overflow');
  await page.goto(`${base}/app/library`);
  await page.getByRole('link', { name: article2.title }).waitFor();
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false, 'long library title wraps');
  await page.screenshot({ path: new URL('../output/library-phone-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.getByRole('link', { name: article2.title }).click();
  await page.getByRole('heading', { name: article2.title }).waitFor();
  assert.equal(await page.locator('body').evaluate(el => el.scrollWidth > window.innerWidth), false, 'article record has no horizontal overflow');
  await page.screenshot({ path: new URL('../output/article-phone-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });

  await page.goto(`${base}/app/settings/privacy`);
  await page.getByRole('heading', { name: 'Visibility', exact: true }).waitFor();
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: new URL('../output/privacy-phone-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.getByRole('button', { name: '履歴をすべて削除', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await page.waitForURL(/\/app$/);
  await page.getByRole('heading', { name: 'まだ読書記録がありません。' }).waitFor();
  await page.reload();
  await page.getByRole('heading', { name: 'まだ読書記録がありません。' }).waitFor();
  assert.equal(records.length, 0);
  await page.getByRole('button', { name: 'ダークモードに切り替え' }).click();
  assert.equal(await page.locator('html').getAttribute('data-theme'), 'dark');
  await page.screenshot({ path: new URL('../output/empty-dark-phone-fixture.png', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'), fullPage: true });
  await page.goto(`${base}/app/settings/privacy`);
  await page.getByRole('button', { name: 'アカウントを削除', exact: true }).click();
  assert.equal(mutations.some(item => item.path === '/me' && item.method === 'DELETE'), false);
  await page.getByLabel('削除の確認').fill('DELETE');
  await page.getByRole('dialog').getByRole('button', { name: '削除する', exact: true }).click();
  await page.getByRole('heading', { name: '続きは、あなたのページで。' }).waitFor();
  assert.equal(authenticated, false);
  authenticated = true;
  await page.goto(`${base}/app`);
  await page.getByRole('heading', { name: 'Reader fixture' }).waitFor();
  authenticated = false;
  await page.getByRole('navigation', { name: 'モバイルナビゲーション' }).getByRole('link', { name: 'Library' }).click();
  await page.getByRole('heading', { name: '続きは、あなたのページで。' }).waitFor();
  assert.ok(page.url().includes('/login'));
  assert.deepEqual(problems, [], 'no uncaught browser errors');
  await writeFile(new URL('../output/browser-smoke.json', import.meta.url), JSON.stringify({ result: 'pass', fixture: 'synthetic', verified: ['auth-required', 'manual-auto-state', 'csrf', 'article-delete-reload', 'privacy-consent-independent-switches', 'json-export', 'last-identity-protection', 'device-revoke-confirmation', 'explicit-device-approval', 'timezone-url-validation', 'public-schema-isolation', 'partial-error-retry', 'desktop-phone-no-overflow', 'all-history-delete-reload', 'dark-mode', 'account-delete-confirmation-logout', 'expired-session-reauthentication'], apiMutations: mutations.length, browserErrors: problems.length }, null, 2));
  console.log('Dashboard synthetic browser smoke: PASS (17 workflows, desktop and 390px phone).');
} finally { await browser.close(); }
