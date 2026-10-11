import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { articleLocation } from '../../../packages/tracker/tracker.js';

const source = await readFile(new URL('../src/content.js', import.meta.url), 'utf8');
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function content({ hold = 'lease', body = false, visible = true } = {}) {
  const delay = deferred(), calls = [], starts = [], documentEvents = {}, windowEvents = {}, timers = [];
  let listener, held = false, mutation, fingerprint = 'fixture';
  const window = { addEventListener: (name, callback) => { windowEvents[name] = callback; } }; window.top = window;
  const document = { visibilityState: visible ? 'visible' : 'hidden', hasFocus: () => true, querySelector: () => body ? {} : null,
    addEventListener: (name, callback) => { documentEvents[name] = callback; } };
  const context = { window, document, location: { href: 'https://en.wikipedia.org/wiki/Example' }, Date,
    setInterval: callback => { timers.push(callback); }, setTimeout: callback => { timers.push(callback); }, clearTimeout: () => {},
    MutationObserver: class { constructor(callback) { mutation = callback; } observe() {} },
    chrome: { runtime: { onMessage: { addListener: callback => { listener = callback; } },
      sendMessage: async message => {
        calls.push(structuredClone(message));
        if (message.type === hold && !held) { held = true; await delay.promise; }
        if (message.type === 'article.resolve') return { enabled: true, article: {}, device_id: 'fixture', recording_epoch: 1 };
        if (message.type === 'lease') return { enabled: true, lease_until: Date.now() + 15000 };
        return { saved: true };
      } } },
    WikiMfTracker: { articleLocation, extractDocument: () => ({}), fingerprint: async () => fingerprint, DOMTracker: class {
      async start(value) { starts.push(value); this.session = { document: { fingerprint } }; }
      async stop() { this.session = null; }
      refreshDocument() {}
    } },
  };
  vm.runInNewContext(source, context); await settle();
  return { context, calls, starts, delay, timers, documentEvents, windowEvents, stop: () => listener({ type: 'tracking.stop' }),
    mutate: async value => { fingerprint = value; mutation(); await timers.at(-1)(); await settle(); } };
}
test('stop, hidden, blur and pagehide invalidate a pending start lease', async () => {
  for (const invalidate of [
    h => h.stop(),
    h => { h.context.document.visibilityState = 'hidden'; h.documentEvents.visibilitychange(); },
    h => h.windowEvents.blur(),
    h => h.windowEvents.pagehide({ persisted: true }),
    h => { h.context.location.href = 'https://en.wikipedia.org/wiki/New_article'; },
  ]) {
    const h = await content(); assert.equal(h.calls.filter(call => call.type === 'lease').length, 1);
    invalidate(h); h.delay.resolve(); await settle(); assert.equal(h.starts.length, 0);
  }
});
test('cancel during resolve prevents any lease request and sends a matching cancellation', async () => {
  const h = await content({ hold: 'article.resolve' });
  const request = h.calls.find(call => call.type === 'article.resolve');
  h.stop(); h.delay.resolve(); await settle();
  assert.ok(h.calls.some(call => call.type === 'article.cancel' && call.request_id === request.request_id));
  assert.equal(h.calls.some(call => call.type === 'lease'), false); assert.equal(h.starts.length, 0);
});
test('pageshow can begin a new attempt without reviving the old pending start', async () => {
  const h = await content({ hold: 'article.resolve' });
  h.windowEvents.pagehide({ persisted: true }); h.windowEvents.pageshow(); await settle();
  assert.equal(h.starts.length, 1);
  h.delay.resolve(); await settle(); assert.equal(h.starts.length, 1);
  const requests = h.calls.filter(call => call.type === 'article.resolve');
  assert.notEqual(requests[0].request_id, requests[1].request_id);
});
test('hidden initial pages do not resolve an article until visible', async () => {
  const h = await content({ hold: 'never', visible: false });
  assert.equal(h.calls.some(call => call.type === 'article.resolve'), false);
  h.context.document.visibilityState = 'visible'; h.windowEvents.pageshow(); await settle();
  assert.equal(h.calls.filter(call => call.type === 'article.resolve').length, 1);
  assert.equal(h.starts.length, 1);
});

test('a hidden document change ends the old session before focus can renew its lease', async () => {
  for (const changed of [false, true]) {
    const h = await content({ hold: 'never', body: true }); assert.equal(h.starts.length, 1);
    h.context.document.visibilityState = 'hidden'; h.documentEvents.visibilitychange(); await settle();
    await h.mutate(changed ? 'new-fingerprint' : 'fixture');
    assert.equal(h.starts.length, 1, 'No new URL or session while hidden');
    h.context.document.visibilityState = 'visible'; h.documentEvents.visibilitychange(); await settle();
    assert.equal(h.starts.length, changed ? 2 : 1);
  }
});
