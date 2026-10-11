import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Outbox } from '../src/outbox.js';
import { ReadingSession } from '../../../packages/tracker/tracker.js';

function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function worker(t, { recording = true, sendQueued = false, enabled = true } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'wikimf-worker-'));
  const auth = { user_id: crypto.randomUUID(), device_id: crypto.randomUUID(), token: 'synthetic-token', recording_epoch: 1 };
  const article = { article_id: crypto.randomUUID(), wiki: 'enwiki', page_id: 9228, namespace: 0, trackable: true };
  const data = { credentials: auth, settings: { recording, sendQueued }, control: { ...auth, collection_enabled: enabled, deletion_markers: [] } };
  const memory = initial => ({ data: initial,
    get: async keys => structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, initial[key]]))),
    set: async values => Object.assign(initial, structuredClone(values)),
    remove: async keys => (Array.isArray(keys) ? keys : [keys]).forEach(key => delete initial[key]),
    clear: async () => Object.keys(initial).forEach(key => delete initial[key]), setAccessLevel: async () => {} });
  const local = memory(data), session = memory({}), listeners = {}, requests = [], stops = [];
  const event = key => ({ addListener: callback => { listeners[key] = callback; } });
  const original = { chrome: globalThis.chrome, fetch: globalThis.fetch };
  const remote = { ...auth, collection_enabled: enabled, deletion_markers: [] };
  let controlStatus = 200, controlFailure = false, nextControl = null, nextResolve = null, batchReply = null;
  globalThis.chrome = { storage: { local, session }, runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path,
    onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (...args) => stops.push(args), create: async () => {}, onActivated: event('activated'), onRemoved: event('removed'), onUpdated: event('updated') },
    windows: { getAll: async () => [{ id: 1, focused: true }], onFocusChanged: event('focus') },
    alarms: { get: async () => ({}), create: async () => {}, onAlarm: event('alarm') } };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname; requests.push({ path, options });
    if (path.endsWith('/recording-control')) {
      if (controlFailure) throw new Error('fixture-offline');
      const snapshot = structuredClone(remote), status = controlStatus, delay = nextControl; nextControl = null;
      if (delay && !delay.decodeError) { delay.started.resolve(); await delay.release.promise; }
      if (delay?.error) throw new Error(delay.error);
      if (delay?.decodeError) return { ok: true, json: async () => {
        delay.started.resolve(); await delay.release.promise; throw new Error(delay.decodeError);
      } };
      return Response.json(snapshot, { status });
    }
    if (path.endsWith('/articles/resolve')) {
      const delay = nextResolve; nextResolve = null;
      if (delay) { delay.started.resolve(); await delay.release.promise; }
      return Response.json(article);
    }
    if (path.endsWith('/reading-events/batch')) {
      const { events } = JSON.parse(options.body);
      if (batchReply) return batchReply(events);
      return Response.json({ results: events.map(item => ({ event_id: item.event_id, status: 'accepted' })), recording_epoch: remote.recording_epoch });
    }
    if (path.includes('/me/articles/')) return Response.json({}, { status: 404 });
    throw new Error('Unexpected fixture path ' + path);
  };
  for (const name of ['worker.js', 'outbox.js', 'sync-state.js']) await copyFile(new URL('../src/' + name, import.meta.url), join(directory, name));
  await copyFile(new URL('../../../packages/tracker/tracker.js', import.meta.url), join(directory, 'tracker-module.js'));
  await writeFile(join(directory, 'config.js'), "export const API_ORIGIN='https://api.fixture'; export const DASHBOARD_ORIGIN='https://dashboard.fixture'; export const CLIENT_VERSION='0.1.0';");
  await writeFile(join(directory, 'package.json'), '{"type":"module"}');
  t.after(async () => { globalThis.chrome = original.chrome; globalThis.fetch = original.fetch; await rm(directory, { recursive: true, force: true }); });
  await import(pathToFileURL(join(directory, 'worker.js')).href);
  const page = { id: 'fixture', url: 'chrome-extension://fixture/popup.html' };
  const content = { id: 'fixture', frameId: 0, documentId: 'document-1', tab: { id: 1 }, url: 'https://en.wikipedia.org/wiki/Private_article' };
  const message = (value, sender = page) => new Promise(resolve => listeners.message(value, sender, resolve));
  await message({ type: 'status' }); await new Promise(resolve => setImmediate(resolve)); requests.length = 0;
  return { auth, article, data, remote, requests, stops, message, content, listeners, local, session,
    deferControl: () => nextControl = { started: deferred(), release: deferred() },
    deferResolve: () => nextResolve = { started: deferred(), release: deferred() },
    batchReply: value => { batchReply = value; }, queue: new Outbox(local),
    failControl: value => { controlFailure = value; }, controlStatus: value => { controlStatus = value; } };
}
function opened(harness, now = Date.now()) {
  return new ReadingSession({ article: harness.article, deviceId: harness.auth.device_id, source: 'chrome_extension', epoch: 1, now, mono: 0,
    document: { fingerprint: 'a'.repeat(64), extractor_version: 'prose-v1', observed_revision_id: null, text_chars: 200, chunk_chars: [200] } }).event('session.opened');
}

test('new page, reload and pageshow resolve disclose no URL while collection is OFF', async t => {
  const h = await worker(t, { enabled: false });
  for (let i = 0; i < 3; i++) assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, false);
  assert.ok(h.requests.every(item => item.path.endsWith('/recording-control')));
  assert.equal(h.requests.some(item => item.options.body), false);
});
test('fresh control overrides stale ON and failures fail closed; reconsent resumes', async t => {
  const h = await worker(t);
  h.remote.collection_enabled = false;
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, false);
  h.remote.collection_enabled = true; h.failControl(true);
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).error, 'fixture-offline');
  assert.equal(h.requests.some(item => item.path.endsWith('/articles/resolve')), false);
  h.failControl(false); h.requests.length = 0;
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
  assert.deepEqual(h.requests.map(item => item.path), ['/api/v1/me/recording-control', '/api/v1/articles/resolve']);
  assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, true);
});
test('explicit sync sends held records without recording or enabling automatic delivery', async t => {
  const h = await worker(t, { recording: false });
  await h.queue.enqueue(h.auth, opened(h));
  h.listeners.alarm({ name: 'wikimf-sync' }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.requests.length, 0); assert.equal((await h.queue.batch(h.auth)).length, 1);
  const status = await h.message({ type: 'sync' });
  assert.equal(status.queued, 0); assert.equal(status.recording, false); assert.equal(status.sendQueued, false);
  assert.deepEqual(h.requests.map(item => item.path), ['/api/v1/me/recording-control', '/api/v1/reading-events/batch']);
});
test('sync then unlink works while automatic delivery is OFF', async t => {
  const h = await worker(t, { recording: false }); await h.queue.enqueue(h.auth, opened(h));
  const result = await h.message({ type: 'logout', discard: false });
  assert.equal(result.linked, false); assert.equal((await h.queue.read()).rows.length, 0);
});
test('explicit sync waits for a concurrently skipped automatic attempt and still sends', async t => {
  const h = await worker(t, { recording: false }); await h.queue.enqueue(h.auth, opened(h));
  h.listeners.alarm({ name: 'wikimf-sync' });
  assert.equal((await h.message({ type: 'sync' })).queued, 0);
  assert.equal(h.requests.filter(item => item.path.endsWith('/reading-events/batch')).length, 1);
});
test('explicit sync still respects remote collection OFF and device revocation', async t => {
  const h = await worker(t, { recording: false, enabled: false }); await h.queue.enqueue(h.auth, opened(h));
  assert.equal((await h.message({ type: 'sync' })).queued, 1);
  h.controlStatus(401); assert.equal((await h.message({ type: 'sync' })).sync, 'reauth_required');
  assert.equal(h.requests.some(item => item.path.endsWith('/reading-events/batch')), false);
});
test('deletion stops the old session and denies start/lease through cutoff, then a fresh session is eligible', async t => {
  const h = await worker(t), originalNow = Date.now;
  let clock = originalNow(); Date.now = () => clock; t.after(() => { Date.now = originalNow; });
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
  const old = opened(h); await h.queue.enqueue(h.auth, old);
  const cutoff = clock + 300000;
  h.remote.deletion_markers = [{ article_id: h.article.article_id, deleted_before: new Date(cutoff).toISOString() }];
  await h.message({ type: 'sync' });
  assert.equal((await h.queue.batch(h.auth)).length, 0); assert.ok(h.stops.length);
  for (const now of [clock, cutoff]) {
    clock = now;
    assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, false);
    assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, false);
  }
  clock = cutoff + 1;
  assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, true);
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
  const fresh = opened(h); assert.notEqual(fresh.session_id, old.session_id);
  assert.ok(Date.parse(fresh.session_started_at) > cutoff);
  await h.queue.enqueue(h.auth, fresh); await h.message({ type: 'sync' });
  assert.equal((await h.queue.batch(h.auth)).length, 0);
});

test('delayed ON cannot overwrite a newer OFF snapshot or disclose the URL', async t => {
  const h = await worker(t), delayed = h.deferControl();
  const pending = h.message({ type: 'article.resolve' }, h.content); await delayed.started.promise;
  h.remote.collection_enabled = false; await h.message({ type: 'sync' });
  const before = structuredClone(h.data.control);
  delayed.release.resolve(); assert.equal((await pending).enabled, false);
  assert.deepEqual(h.data.control, before);
  assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, false);
  assert.equal((await h.message({ type: 'status' })).recording_enabled, false);
  assert.equal(h.requests.some(item => item.path.endsWith('/articles/resolve')), false);
});
test('delayed control cannot erase a newer deletion marker or prune fresh epoch rows', async t => {
  const h = await worker(t), delayed = h.deferControl();
  const pending = h.message({ type: 'article.resolve' }, h.content); await delayed.started.promise;
  h.remote.recording_epoch = 2;
  h.remote.deletion_markers = [{ article_id: h.article.article_id, deleted_before: new Date(Date.now() - 1000).toISOString() }];
  await h.message({ type: 'sync' });
  const fresh = { ...opened(h), recording_epoch: 2 }; await h.queue.enqueue(h.auth, fresh);
  const before = structuredClone({ control: h.data.control, outbox: h.data.outbox });
  delayed.release.resolve(); assert.equal((await pending).enabled, false);
  assert.deepEqual({ control: h.data.control, outbox: h.data.outbox }, before);
});
test('a newer failed control request also invalidates an earlier ON and cached leases', async t => {
  const h = await worker(t), delayed = h.deferControl();
  const pending = h.message({ type: 'article.resolve' }, h.content); await delayed.started.promise;
  h.failControl(true); assert.ok((await h.message({ type: 'article.resolve' }, h.content)).error);
  delayed.release.resolve(); assert.equal((await pending).enabled, false);
  assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, false);
  assert.equal(h.requests.some(item => item.path.endsWith('/articles/resolve')), false);
});
test('local pause while automatic sync awaits control retains the queue', async t => {
  const h = await worker(t); await h.queue.enqueue(h.auth, opened(h));
  const delayed = h.deferControl(); h.listeners.alarm({ name: 'wikimf-sync' }); await delayed.started.promise;
  await h.message({ type: 'recording', enabled: false, sendQueued: false });
  delayed.release.resolve(); await settle();
  assert.equal((await h.queue.read()).rows.length, 1);
  assert.equal(h.requests.some(item => item.path.endsWith('/reading-events/batch')), false);
});
test('local cancellation, navigation, focus, pause and account changes deny a pending URL disclosure', async t => {
  const h = await worker(t);
  for (const change of [
    () => h.message({ type: 'article.cancel', request_id: 8 }, h.content),
    () => h.listeners.updated(1, { status: 'loading' }),
    () => h.listeners.updated(1, { url: 'https://en.wikipedia.org/wiki/Other' }),
    () => h.listeners.activated({ tabId: 2 }),
    () => h.listeners.focus(2),
    () => h.message({ type: 'recording', enabled: false, sendQueued: false }),
    () => { h.data.credentials = { ...h.auth, user_id: crypto.randomUUID() }; },
    () => { h.data.credentials = { ...h.auth, device_id: crypto.randomUUID() }; },
    () => { h.data.credentials = { ...h.auth, token: 'new-fixture-token' }; },
  ]) {
    h.data.credentials = h.auth; h.data.settings.recording = true; h.requests.length = 0;
    const delayed = h.deferControl(), pending = h.message({ type: 'article.resolve', request_id: 8 }, h.content);
    await delayed.started.promise; await change(); delayed.release.resolve();
    assert.equal((await pending).enabled, false);
    assert.equal(h.requests.some(item => item.path.endsWith('/articles/resolve')), false);
  }
});
test('cancel from an older document or request cannot cancel the current resolve', async t => {
  const h = await worker(t), delayed = h.deferControl();
  const pending = h.message({ type: 'article.resolve', request_id: 8 }, h.content); await delayed.started.promise;
  await h.message({ type: 'article.cancel', request_id: 7 }, h.content);
  await h.message({ type: 'article.cancel', request_id: 8 }, { ...h.content, documentId: 'old-document' });
  delayed.release.resolve(); assert.equal((await pending).enabled, true);
});
test('fragment navigation preserves the binding and current document', async t => {
  const h = await worker(t); assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
  const before = structuredClone(h.session.data);
  await h.listeners.updated(1, { url: h.content.url + '#Section' });
  assert.deepEqual(h.session.data, before);
  assert.equal((await h.message({ type: 'observation', event: opened(h) }, h.content)).saved, true);
  await settle();
});
test('late article results cannot restore a binding after pause, navigation, or unlink', async t => {
  const h = await worker(t);
  for (const change of [
    () => h.message({ type: 'recording', enabled: false, sendQueued: false }),
    () => h.listeners.updated(1, { status: 'loading' }),
    () => h.message({ type: 'logout', discard: true }),
  ]) {
    h.data.credentials = h.auth; h.data.settings.recording = true;
    const delayed = h.deferResolve(), pending = h.message({ type: 'article.resolve' }, h.content);
    await delayed.started.promise; await change(); delayed.release.resolve();
    assert.equal((await pending).enabled, false);
    assert.equal(h.session.data['binding:1'], undefined);
  }
});
test('changing retention while recording survives pause and recording still auto-syncs', async t => {
  const h = await worker(t, { sendQueued: true });
  await h.message({ type: 'recording', enabled: true, sendQueued: false }); await settle();
  assert.equal(h.data.settings.recording, true); assert.equal(h.data.settings.sendQueued, false);
  await h.queue.enqueue(h.auth, opened(h)); h.listeners.alarm({ name: 'wikimf-sync' }); await settle();
  assert.equal((await h.queue.read()).rows.length, 0);
  await h.message({ type: 'recording', enabled: false, sendQueued: false });
  assert.equal(h.data.settings.sendQueued, false);
  await h.queue.enqueue(h.auth, opened(h)); h.listeners.alarm({ name: 'wikimf-sync' }); await settle();
  assert.equal((await h.queue.read()).rows.length, 1);
});
test('newer OFF settings win over an older pending enable', async t => {
  const h = await worker(t, { recording: false }), delayed = h.deferControl();
  const pending = h.message({ type: 'recording', enabled: true, sendQueued: true }); await delayed.started.promise;
  await h.message({ type: 'recording', enabled: false, sendQueued: false }); delayed.release.resolve(); await pending;
  assert.deepEqual(h.data.settings, { recording: false, sendQueued: false });
});
test('sync-and-unlink drains more than two batches and preserves other owners', async t => {
  const h = await worker(t, { recording: false });
  const rows = Array.from({ length: 251 }, () => ({ owner: h.auth, created_at: Date.now(), event: opened(h) }));
  const foreign = { user_id: crypto.randomUUID(), device_id: crypto.randomUUID() };
  rows.push({ owner: foreign, created_at: Date.now(), event: { ...opened(h), device_id: foreign.device_id } });
  h.data.outbox = { rows, quarantine: [], lossCount: 0 };
  assert.equal((await h.message({ type: 'logout', discard: false })).linked, false);
  assert.deepEqual(h.requests.filter(item => item.path.endsWith('/reading-events/batch')).map(item => JSON.parse(item.options.body).events.length), [100, 100, 51]);
  assert.deepEqual((await h.queue.read()).rows, [rows.at(-1)]);
});
test('unlink stops on no progress, missing/retryable ACK, HTTP failure and collection OFF', async t => {
  const h = await worker(t, { recording: false });
  for (const reply of [
    () => Response.json({ results: [], recording_epoch: 1 }),
    events => Response.json({ results: events.map(event => ({ event_id: event.event_id, status: 'rejected', retryable: true })), recording_epoch: 1 }),
    () => Response.json({}, { status: 503 }),
    () => Response.json({}, { status: 401 }),
  ]) {
    h.requests.length = 0; h.data.outbox = { rows: [], quarantine: [], lossCount: 0 };
    await h.queue.enqueue(h.auth, opened(h)); h.batchReply(reply);
    assert.equal((await h.message({ type: 'logout', discard: false })).error, 'unsent_records');
    assert.equal((await h.queue.read()).rows.length, 1); assert.deepEqual(h.data.credentials, h.auth);
    assert.equal(h.requests.filter(item => item.path.endsWith('/reading-events/batch')).length, 1);
  }
  h.requests.length = 0; h.remote.collection_enabled = false;
  assert.equal((await h.message({ type: 'logout', discard: false })).error, 'unsent_records');
  assert.equal(h.requests.some(item => item.path.endsWith('/reading-events/batch')), false);
});
test('unlink rechecks collection control between batches and retains the unacknowledged suffix', async t => {
  const h = await worker(t, { recording: false });
  h.data.outbox = { rows: Array.from({ length: 101 }, () => ({ owner: h.auth, created_at: Date.now(), event: opened(h) })), quarantine: [], lossCount: 0 };
  h.batchReply(events => {
    h.remote.collection_enabled = false;
    return Response.json({ results: events.map(event => ({ event_id: event.event_id, status: 'accepted' })), recording_epoch: 1 });
  });
  assert.equal((await h.message({ type: 'logout', discard: false })).error, 'unsent_records');
  assert.equal((await h.queue.read()).rows.length, 1); assert.deepEqual(h.data.credentials, h.auth);
  assert.equal(h.requests.filter(item => item.path.endsWith('/reading-events/batch')).length, 1);
});
test('account change during unlink cannot clear the new account or its queue', async t => {
  const h = await worker(t, { recording: false }); await h.queue.enqueue(h.auth, opened(h));
  const delayed = h.deferControl(), pending = h.message({ type: 'logout', discard: false }); await delayed.started.promise;
  const other = { ...h.auth, user_id: crypto.randomUUID(), device_id: crypto.randomUUID() }; h.data.credentials = other;
  await h.queue.enqueue(other, { ...opened(h), device_id: other.device_id });
  const before = structuredClone(h.data.outbox); delayed.release.resolve();
  assert.equal((await pending).error, 'unsent_records');
  assert.deepEqual(h.data.credentials, other); assert.deepEqual(h.data.outbox, before);
});


test('late network, decode and unauthorized replies cannot overwrite a newer success', async t => {
  const h = await worker(t);
  for (const kind of ['error', 'decodeError', 'unauthorized']) {
    h.requests.length = 0;
    if (kind === 'unauthorized') h.controlStatus(401);
    const delayed = h.deferControl();
    if (kind !== 'unauthorized') delayed[kind] = 'old-failure';
    const pending = h.message({ type: 'sync' }); await delayed.started.promise;
    h.controlStatus(200);
    assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
    const before = structuredClone({ control: h.data.control, status: h.data.syncStatus, retryAt: h.data.retryAt });
    delayed.release.resolve(); await pending;
    assert.deepEqual({ control: h.data.control, status: h.data.syncStatus, retryAt: h.data.retryAt }, before);
    assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, true);
  }
});
test('an epoch rollback from even a newer request cannot prune fresh records', async t => {
  const h = await worker(t); h.remote.recording_epoch = 2; await h.message({ type: 'sync' });
  await h.queue.enqueue(h.auth, { ...opened(h), recording_epoch: 2 });
  const before = structuredClone({ control: h.data.control, outbox: h.data.outbox });
  h.remote.recording_epoch = 1;
  assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, false);
  assert.deepEqual({ control: h.data.control, outbox: h.data.outbox }, before);
});

test('deletion cutoffs merge monotonically per article for the current owner only', async t => {
  const h = await worker(t), cutoff = new Date(Date.now() + 300000).toISOString(), otherArticle = crypto.randomUUID();
  h.remote.deletion_markers = [{ article_id: h.article.article_id, deleted_before: cutoff }]; await h.message({ type: 'sync' });
  h.remote.deletion_markers = [{ article_id: h.article.article_id, deleted_before: new Date(Date.now() - 1000).toISOString() },
    { article_id: otherArticle, deleted_before: cutoff }]; await h.message({ type: 'sync' });
  assert.deepEqual(h.data.control.deletion_markers, [{ article_id: h.article.article_id, deleted_before: cutoff }, { article_id: otherArticle, deleted_before: cutoff }]);
  h.remote.deletion_markers = []; await h.message({ type: 'sync' }); assert.equal(h.data.control.deletion_markers.length, 2);
  h.data.control = { ...h.data.control, user_id: crypto.randomUUID() };
  await h.message({ type: 'sync' }); assert.deepEqual(h.data.control.deletion_markers, []);
});
test('unlink and relink with the same identity cannot revive an old control attempt', async t => {
  const h = await worker(t), delayed = h.deferControl();
  const pending = h.message({ type: 'article.resolve' }, h.content); await delayed.started.promise;
  await h.message({ type: 'logout', discard: true });
  h.data.credentials = h.auth; h.data.settings = { recording: true, sendQueued: false };
  delayed.release.resolve(); assert.equal((await pending).enabled, false);
  assert.equal(h.data.control, undefined); assert.equal(h.requests.some(item => item.path.endsWith('/articles/resolve')), false);
});

test('terminal status queued by an older control cannot commit after a newer request starts', async t => {
  const h = await worker(t), blocked = deferred(), release = deferred(), get = h.local.get;
  let hold = true;
  h.local.get = async keys => {
    const value = await get(keys);
    if (hold && keys === 'syncStatus') { hold = false; blocked.resolve(); await release.promise; }
    return value;
  };
  h.controlStatus(401); const pending = h.message({ type: 'sync' }); await blocked.promise;
  h.controlStatus(200);
  const newer = h.message({ type: 'article.resolve' }, h.content);
  await settle(); release.resolve();
  await pending; assert.equal((await newer).enabled, true);
  assert.notEqual(h.data.syncStatus?.code, 'reauth_required');
  assert.equal((await h.message({ type: 'lease' }, h.content)).enabled, true);
});

test('retention preference can change independently while an already recording device is offline', async t => {
  const h = await worker(t, { sendQueued: true }); h.failControl(true);
  const result = await h.message({ type: 'recording', enabled: true, sendQueued: false }); await settle();
  assert.equal(result.error, undefined); assert.equal(h.data.settings.recording, true); assert.equal(h.data.settings.sendQueued, false);
  await h.message({ type: 'recording', enabled: false, sendQueued: false });
  assert.deepEqual(h.data.settings, { recording: false, sendQueued: false });
});
test('a fresh ON control clears only the old server-paused label', async t => {
  const h = await worker(t); h.remote.collection_enabled = false; await h.message({ type: 'sync' });
  assert.equal(h.data.syncStatus.code, 'server_paused');
  h.remote.collection_enabled = true; assert.equal((await h.message({ type: 'article.resolve' }, h.content)).enabled, true);
  const status = await h.message({ type: 'status' }); assert.equal(status.recording_enabled, true); assert.equal(status.sync, 'idle');
});

test('explicit sync queued behind another attempt stays bound to its account and generation', async t => {
  const h = await worker(t, { recording: false });
  for (const aba of [false, true]) {
    h.data.credentials = h.auth; h.remote.user_id = h.auth.user_id; h.remote.device_id = h.auth.device_id;
    h.data.outbox = { rows: [], quarantine: [], lossCount: 0 }; h.requests.length = 0;
    await h.queue.enqueue(h.auth, opened(h));
    const delayed = h.deferControl(), first = h.message({ type: 'sync' }); await delayed.started.promise;
    const queued = h.message({ type: 'sync' }); await settle();
    if (aba) await h.message({ type: 'logout', discard: true });
    const other = aba ? h.auth : { ...h.auth, user_id: crypto.randomUUID(), device_id: crypto.randomUUID() };
    h.data.credentials = other; h.data.settings = { recording: false, sendQueued: false };
    h.remote.user_id = other.user_id; h.remote.device_id = other.device_id;
    await h.queue.enqueue(other, { ...opened(h), device_id: other.device_id });
    const before = structuredClone(h.data.outbox); delayed.release.resolve(); await first; await queued;
    assert.equal(h.requests.some(item => item.path.endsWith('/reading-events/batch')), false);
    assert.deepEqual(h.data.outbox, before);
  }
});

test('unlink drains split 413 batches using the current epoch rather than the original link epoch', async t => {
  const h = await worker(t, { recording: false }); h.remote.recording_epoch = 2;
  h.data.outbox = { rows: Array.from({ length: 101 }, () => ({ owner: h.auth, created_at: Date.now(), event: { ...opened(h), recording_epoch: 2 } })), quarantine: [], lossCount: 0 };
  h.batchReply(events => events.length > 50 ? Response.json({}, { status: 413 }) :
    Response.json({ results: events.map(event => ({ event_id: event.event_id, status: 'accepted' })), recording_epoch: 2 }));
  assert.equal((await h.message({ type: 'logout', discard: false })).linked, false);
  assert.equal((await h.queue.read()).rows.length, 0);
  assert.deepEqual(h.requests.filter(item => item.path.endsWith('/reading-events/batch')).map(item => JSON.parse(item.options.body).events.length), [100, 50, 50, 1]);
});
