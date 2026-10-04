// Actual installed Google Chrome + MV3/CDP; the HTTP API and article body are fixtures.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { ReadingSession } from '../../../packages/tracker/tracker.js';
import { QUEUE_AGE_MS, QUEUE_LIMIT, validateObservation } from '../src/outbox.js';

const require = createRequire(import.meta.url);
const runtime = process.env.WIKIMF_NODE_MODULES || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(resolve(runtime, 'playwright'));
const account = { user_id: crypto.randomUUID(), device_id: crypto.randomUUID(), token: 'fixture-device-token', recording_epoch: 1, display_name: 'Fixture account' };
const article = { article_id: crypto.randomUUID(), wiki: 'jawiki', page_id: 1, namespace: 0, trackable: true, title: 'Fixture', canonical_url: 'https://ja.wikipedia.org/wiki/Fixture' };
const control = { user_id: account.user_id, device_id: account.device_id, recording_epoch: 1, collection_enabled: true, deletion_markers: [] };
const received = [], results = [];
let offline = false;
const server = http.createServer(async (req, res) => {
  if (offline) { res.writeHead(503); res.end('{}'); return; }
  let body = ''; for await (const part of req) body += part;
  res.setHeader('Content-Type', 'application/json');
  if (req.headers.authorization !== 'Bearer ' + account.token) { res.writeHead(401); res.end('{}'); return; }
  if (req.url === '/api/v1/me/recording-control') res.end(JSON.stringify(control));
  else if (req.url === '/api/v1/articles/resolve') res.end(JSON.stringify(article));
  else if (req.url === '/api/v1/reading-events/batch') {
    const { events } = JSON.parse(body); received.push(...events);
    res.end(JSON.stringify({ results: events.map(event => ({ event_id: event.event_id, status: 'accepted' })), recording_epoch: 1, server_time: new Date().toISOString() }));
  } else { res.writeHead(404); res.end('{}'); }
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
process.env.WIKIMF_API_ORIGIN = 'http://127.0.0.1:' + server.address().port;
process.env.WIKIMF_EXTENSION_OUTPUT = './.browser-tests/queue-extension/';
await import('../build.js');
const profile = fileURLToPath(new URL('../.browser-tests/queue-' + crypto.randomUUID() + '/', import.meta.url));
await mkdir(profile, { recursive: true });
const reportPath = new URL('../.browser-tests/queue-recovery' + (process.argv.includes('--baseline') ? '-baseline' : '') + '.json', import.meta.url);
let context, version, extensionId, failure;

function observation(large = false) {
  const now = Date.now(), chunk_chars = large ? Array(5000).fill(200) : [200];
  const event = new ReadingSession({ article, deviceId: account.device_id, source: 'chrome_extension', epoch: 1, now, mono: 0,
    document: { fingerprint: 'a'.repeat(64), extractor_version: 'prose-v1', observed_revision_id: null, text_chars: large ? 1000000 : 200, chunk_chars } }).event('session.opened');
  if (large) event.progress.covered_chunk_ids = Array.from({ length: 5000 }, (_, index) => index);
  assert.equal(validateObservation(event), true);
  return event;
}
function row(event, created_at = Date.now()) { return { owner: { user_id: account.user_id, device_id: account.device_id }, created_at, event }; }
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.WIKIMF_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'], args: ['--enable-unsafe-extension-debugging'], viewport: { width: 1100, height: 760 }
  });
  const browserCdp = await context.browser().newBrowserCDPSession();
  version = (await browserCdp.send('Browser.getVersion')).product;
  extensionId = (await browserCdp.send('Extensions.loadUnpacked', { path: fileURLToPath(new URL('../.browser-tests/queue-extension/', import.meta.url)) })).id;
  assert.ok((await browserCdp.send('Extensions.getExtensions')).extensions.some(item => item.id === extensionId && item.enabled));
  const management = await context.newPage(); await management.goto('chrome://extensions');
  const developer = management.locator('#devMode');
  if (await developer.count() && !(await developer.evaluate(element => element.checked))) await developer.click();
  results.push({ check: 'installed-google-chrome-developer-mv3', passed: true });
  const popup = await context.newPage(); await popup.goto('chrome-extension://' + extensionId + '/popup.html');
  const fixture = await readFile(new URL('../../../packages/tracker/test/fixtures/prose.html', import.meta.url), 'utf8');
  await context.route('https://ja.wikipedia.org/wiki/Fixture*', route => route.fulfill({ status: 200, contentType: 'text/html', body: fixture }));
  await popup.evaluate(values => chrome.storage.local.set(values), { credentials: account, settings: { recording: true, sendQueued: false }, control });
  const page = await context.newPage(); await page.goto(article.canonical_url); await page.bringToFront();
  await popup.waitForFunction(() => chrome.storage.session.get(null).then(values => Object.keys(values).some(key => key.startsWith('binding:'))));
  const pageCdp = await context.newCDPSession(page), worlds = [];
  pageCdp.on('Runtime.executionContextCreated', event => worlds.push(event.context)); await pageCdp.send('Runtime.enable');
  const isolated = worlds.find(world => world.name.includes(extensionId) || world.origin === 'chrome-extension://' + extensionId);
  assert.ok(isolated, 'real content script isolated world');
  const content = async message => {
    const response = await pageCdp.send('Runtime.evaluate', { contextId: isolated.id, expression: 'chrome.runtime.sendMessage(' + JSON.stringify(message) + ')', awaitPromise: true, returnByValue: true });
    assert.ok(!response.exceptionDetails, 'content bridge completed'); return response.result.value;
  };
  const send = message => popup.evaluate(message => chrome.runtime.sendMessage(message), message);
  const local = keys => popup.evaluate(keys => chrome.storage.local.get(keys), keys);
  const seed = values => popup.evaluate(values => chrome.storage.local.set(values), values);
  async function restartWorker() {
    const { targetInfos } = await browserCdp.send('Target.getTargets');
    const target = targetInfos.find(target => target.type === 'service_worker' && target.url.includes(extensionId));
    assert.ok(target); assert.equal((await browserCdp.send('Target.closeTarget', { targetId: target.targetId })).success, true);
  }
  async function stopTracker() {
    // Quiesce an in-flight ACK before replacing fixture storage. Keep the article
    // unfocused until its failure is stored so the periodic tracker cannot clean it first.
    await popup.bringToFront();
    await send({ type: 'recording', enabled: false, sendQueued: false });
    await send({ type: 'sync' }); await page.waitForTimeout(200); await send({ type: 'sync' });
  }
  async function assertResumed() {
    await page.bringToFront();
    assert.equal((await content({ type: 'lease' })).enabled, true, 'queue recovery must restore lease');
    const state = await send({ type: 'status' });
    assert.ok(['idle', 'synced'].includes(state.sync)); assert.equal(state.recording, true); assert.equal(state.recording_enabled, true);
    const event = observation(); assert.equal((await content({ type: 'observation', event })).saved, true);
    return state;
  }
  async function assertPopup(code, paused) {
    await popup.reload();
    await popup.waitForFunction(expected => document.getElementById('status').textContent.includes(expected), paused ? '記録一時停止' : '記録中');
    assert.equal((await send({ type: 'status' })).sync, code);
    assert.equal(await popup.locator('#recording').isChecked(), true);
  }

  // Seed a valid near-limit durable queue, then fail the actual trusted observation append.
  await stopTracker();
  const full = { rows: [], quarantine: [], lossCount: 0 }, large = observation(true);
  const rowBytes = Buffer.byteLength(JSON.stringify(row(large))) + 1;
  const rowCount = Math.floor((QUEUE_LIMIT - Buffer.byteLength(JSON.stringify(full)) + 1) / rowBytes);
  full.rows = Array.from({ length: rowCount }, () => row({ ...large, event_id: crypto.randomUUID() }));
  assert.ok(Buffer.byteLength(JSON.stringify(full)) <= QUEUE_LIMIT);
  assert.ok(Buffer.byteLength(JSON.stringify(full)) + rowBytes > QUEUE_LIMIT);
  await seed({ outbox: full, syncStatus: { code: 'idle', at: Date.now() }, settings: { recording: true, sendQueued: false } });
  assert.equal((await content({ type: 'observation', event: large })).error, 'queue_full');
  assert.equal((await local('outbox')).outbox.rows.length, full.rows.length);
  assert.equal((await local('syncStatus')).syncStatus.code, 'queue_full');
  await page.bringToFront();
  assert.equal((await content({ type: 'lease' })).enabled, false);
  results.push({ check: 'queue_full-real-append-refused-and-retained', rows: full.rows.length, passed: true });
  if (!process.argv.includes('--baseline')) await assertPopup('queue_full', true);
  popup.once('dialog', dialog => dialog.accept()); await popup.locator('#discard').click();
  await popup.waitForFunction(() => chrome.storage.local.get('outbox').then(value => value.outbox.rows.length === 0));
  await assertResumed();
  results.push({ check: 'queue_full-popup-discard-restores-lease-and-observation', passed: true });
  await assertPopup('idle', false);
  results.push({ check: 'recovered-popup-and-worker-agree', passed: true });
  await restartWorker(); await assertResumed();
  results.push({ check: 'recovered-lease-survives-worker-restart', passed: true });

  // An ACK can make enough room without discarding the whole retained queue.
  await stopTracker();
  await seed({ outbox: full, syncStatus: { code: 'idle', at: Date.now() }, settings: { recording: true, sendQueued: false } });
  assert.equal((await content({ type: 'observation', event: observation(true) })).error, 'queue_full');
  const acceptedBefore = received.length;
  await seed({ settings: { recording: true, sendQueued: true } }); await send({ type: 'sync' });
  assert.ok(received.length > acceptedBefore); assert.ok((await local('outbox')).outbox.rows.length < full.rows.length);
  await assertResumed();
  results.push({ check: 'queue_full-ACK-space-restores-lease-with-retained-records', passed: true });

  // Cleanup must recover even though there is no event batch to ACK.
  await stopTracker();
  const expired = observation(), fresh = observation();
  await seed({ outbox: { rows: [row(expired, Date.now() - QUEUE_AGE_MS - 1000)], quarantine: [], lossCount: 0 }, syncStatus: { code: 'idle', at: Date.now() }, settings: { recording: true, sendQueued: false } });
  assert.equal((await content({ type: 'observation', event: fresh })).error, 'queue_expired');
  assert.equal((await local('syncStatus')).syncStatus.code, 'queue_expired');
  await page.bringToFront();
  assert.equal((await content({ type: 'lease' })).enabled, false);
  await assertPopup('queue_expired', true);
  await popup.bringToFront();
  const batchesBefore = received.length;
  await seed({ settings: { recording: true, sendQueued: true } });
  const cleaned = await send({ type: 'sync' });
  assert.equal(cleaned.error, undefined); assert.equal(cleaned.discarded, 1); assert.equal(received.length, batchesBefore, 'empty cleanup must not depend on a successful ACK');
  assert.equal((await local('outbox')).outbox.rows.some(row => row.event.event_id === expired.event_id), false);
  await assertResumed();
  results.push({ check: 'queue_expired-control-empty-cleanup-restores-lease-and-observation', passed: true });

  // Terminal status remains sticky through both discard/empty sync and a successful ACK.
  for (const code of ['schema_mismatch', 'device_revoked', 'owner_mismatch', 'reauth_required']) {
    await stopTracker();
    await seed({ outbox: { rows: [row(observation())], quarantine: [], lossCount: 0 }, syncStatus: { code, at: Date.now() }, settings: { recording: true, sendQueued: true } });
    assert.equal((await send({ type: 'discard' })).sync, code);
    assert.equal((await send({ type: 'sync' })).sync, code);
    await seed({ outbox: { rows: [row(observation())], quarantine: [], lossCount: 0 } });
    offline = true; assert.equal((await send({ type: 'sync' })).sync, code); offline = false;
    assert.equal((await send({ type: 'sync' })).sync, code);
    assert.equal((await local('outbox')).outbox.rows.length, 0, 'successful ACK was exercised');
    await page.bringToFront(); assert.equal((await content({ type: 'lease' })).enabled, false);
    const state = await send({ type: 'status' }); assert.equal(state.recording_enabled, false);
    await assertPopup(code, true);
    results.push({ check: 'terminal-preserved-discard-empty-sync-offline-success-ACK-popup-lease', code, passed: true });
  }
  await restartWorker(); await page.bringToFront();
  assert.equal((await content({ type: 'lease' })).enabled, false);
  assert.equal((await send({ type: 'status' })).sync, 'reauth_required');
  results.push({ check: 'terminal-stop-survives-worker-restart', passed: true });
  console.log(JSON.stringify({ fixture_api: true, chrome: version, extension_id: extensionId, results }, null, 2));
} catch (error) {
  failure = error.message;
  throw error;
} finally {
  await writeFile(reportPath, JSON.stringify({ fixture_api: true, chrome: version, extension_id: extensionId, results, ...(failure ? { failure } : {}) }, null, 2));
  await context?.close(); await new Promise(done => server.close(done));
}
