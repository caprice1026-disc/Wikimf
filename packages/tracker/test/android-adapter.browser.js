// Opt-in real DOM check. Native lifecycle is covered by Android instrumentation.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { validateObservation } from '../../../apps/extension/src/outbox.js';
await import('../build.js');
const require = createRequire(import.meta.url);
const runtime = process.env.WIKIMF_NODE_MODULES || resolve(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(resolve(runtime, 'playwright'));
const browser = await chromium.launch({ executablePath: process.env.WIKIMF_CHROME, headless: true });
try {
  const page = await browser.newPage();
  const fixture = await readFile(new URL('./fixtures/prose.html', import.meta.url), 'utf8');
  await page.route('https://en.wikipedia.org/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
  await page.goto('https://en.wikipedia.org/wiki/Fixture'); await page.bringToFront();
  const context = { article: { article_id: crypto.randomUUID(), wiki: 'enwiki', page_id: 9228 }, deviceId: crypto.randomUUID(), epoch: 1, sessionId: crypto.randomUUID(), active: true };
  const bundle = await readFile(new URL('../dist/android-tracker.js', import.meta.url), 'utf8');
  await page.evaluate(context => { window.WKMF_CONTEXT = context; window.events = []; window.WikimfObservation = { postMessage: raw => window.events.push(JSON.parse(raw)) }; }, context);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(() => window.events.some(event => event.type === 'session.opened'));
  await page.waitForTimeout(3100);
  const before = await page.evaluate(() => {
    window.WKMF_NATIVE.setActive(false);
    return window.events.at(-1).progress.active_ms_total;
  });
  await page.evaluate(() => document.querySelector('#lead').append('本文更新'));
  await page.waitForFunction(() => window.events.some(event => event.kind === 'document_changed'));
  const first = await page.evaluate(() => window.events);
  const closed = first.find(event => event.type === 'session.closed');
  assert.equal(closed.reason, 'document_changed'); assert.equal(closed.progress.active_ms_total, before);
  assert.ok(first.filter(event => event.type).every(validateObservation));
  const freshId = crypto.randomUUID();
  await page.evaluate(id => { window.WKMF_CONTEXT = { ...window.WKMF_CONTEXT, sessionId: id, active: true }; }, freshId);
  await page.addScriptTag({ content: bundle });
  await page.waitForFunction(id => window.events.some(event => event.session_id === id && event.type === 'session.opened'), freshId);
  const second = await page.evaluate(() => window.events.filter(event => event.type === 'session.opened'));
  assert.notEqual(second[0].document.fingerprint, second[1].document.fingerprint);
  assert.equal(second[1].session_id, freshId); assert.equal(second[1].progress.active_ms_total, 0);
  await page.evaluate(() => window.WKMF_NATIVE.setActive(false)); await page.waitForTimeout(500);
  await page.evaluate(() => window.WKMF_NATIVE.setActive(true));
  assert.equal(await page.evaluate(() => window.WKMF_NATIVE.sessionId), freshId);
  console.log(JSON.stringify({ browser: await browser.version(), hidden_dom_change: 'passed', no_hidden_time: 'passed', new_document_session: 'passed', unchanged_document_session: 'passed' }));
} finally { await browser.close(); }
