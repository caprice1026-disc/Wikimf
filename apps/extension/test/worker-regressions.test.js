import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, copyFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { Outbox } from '../src/outbox.js';
import { ReadingSession } from '../../../packages/tracker/tracker.js';

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
  let controlStatus = 200, controlFailure = false;
  globalThis.chrome = { storage: { local, session }, runtime: { id: 'fixture', getURL: path => 'chrome-extension://fixture/' + path,
    onMessage: event('message'), onInstalled: event('installed'), onStartup: event('startup') },
    tabs: { query: async () => [{ id: 1 }], sendMessage: async (...args) => stops.push(args), create: async () => {}, onActivated: event('activated'), onRemoved: event('removed') },
    windows: { getAll: async () => [{ id: 1, focused: true }], onFocusChanged: event('focus') },
    alarms: { get: async () => ({}), create: async () => {}, onAlarm: event('alarm') } };
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname; requests.push({ path, options });
    if (path.endsWith('/recording-control')) {
      if (controlFailure) throw new Error('fixture-offline');
      return Response.json(remote, { status: controlStatus });
    }
    if (path.endsWith('/articles/resolve')) return Response.json(article);
    if (path.endsWith('/reading-events/batch')) {
      const { events } = JSON.parse(options.body);
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
  return { auth, article, data, remote, requests, stops, message, content, listeners, queue: new Outbox(local),
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
