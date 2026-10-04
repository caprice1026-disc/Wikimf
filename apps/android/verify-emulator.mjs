// Read-only public observations plus explicit adb/CDP actions on the dedicated debug emulator.
// Authentication is loaded privately from the local QA fixture and never enters CDP or reports.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const evidence = path.join(root, 'apps/android/verification/emulator-st-observations.json');
const [operation, label, ...args] = process.argv.slice(2);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
function record(value) {
  const all = fs.existsSync(evidence) ? JSON.parse(fs.readFileSync(evidence, 'utf8')) : [];
  all.push({at: new Date().toISOString(), operation, label, ...value});
  fs.writeFileSync(evidence, JSON.stringify(all, null, 2) + '\n');
  console.log(JSON.stringify(value));
}
async function cdp(expression, method = 'Runtime.evaluate', params = {expression, returnByValue: true}) {
  let targets;
  for (let attempt = 0; attempt < 30; attempt++) {
    try { targets = await fetch('http://127.0.0.1:9223/json').then(r => r.json()); if (targets.length) break; } catch { }
    await delay(300);
  }
  if (!targets?.length) throw new Error('Reader CDP target unavailable after 9 seconds');
  const target = targets.find(t => t.type === 'page') || targets[0];
  if (!target) throw new Error('Reader CDP target unavailable');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('CDP timeout')), 10000);
    ws.onmessage = e => { const result = JSON.parse(e.data); if (result.id === 1) { clearTimeout(timer); resolve(result); } };
    ws.send(JSON.stringify({id: 1, method, params}));
  });
  ws.close();
  if (result.error) throw new Error(result.error.message);
  if (result.result.exceptionDetails) throw new Error(result.result.exceptionDetails.text);
  return result.result.result?.value;
}
async function web(apiPath, method = 'GET', body) {
  const fixturePath = process.env.WIKIMF_QA_FIXTURE || '.tmp/backend-live-smoke.json';
  const fixture = JSON.parse(fs.readFileSync(path.resolve(root, fixturePath), 'utf8').replace(/^\uFEFF/, ''));
  let base = fixture.api_origin.replace(/\/$/, '');
  if (!base.endsWith('/api/v1')) base += '/api/v1';
  if (!['localhost', '127.0.0.1'].includes(new URL(base).hostname)) throw new Error('Local QA only');
  const response = await fetch(base + apiPath, {method, headers: {'Cookie': fixture.cookie.name + '=' + fixture.cookie.value, 'X-CSRF-Token': fixture.csrf, 'Content-Type': 'application/json'}, body: body ? JSON.stringify(body) : undefined});
  if (!response.ok) throw new Error(`QA API HTTP ${response.status}`);
  return response.json();
}
if (operation === 'probe') {
  const value = JSON.parse(await cdp('JSON.stringify({url:location.href,scrollY,historyLength:history.length,focus:document.hasFocus(),visibility:document.visibilityState,sessionId:window.WKMF_NATIVE?.sessionId,epoch:window.WKMF_CONTEXT?.epoch,ready:document.readyState,width:innerWidth,pageId:window.mw?.config?.get("wgArticleId"),namespace:window.mw?.config?.get("wgNamespaceNumber"),errorCode:document.querySelector(".error-code")?.textContent})'));
  record({pid: process.env.WIKIMF_READER_PID, ...value});
} else if (operation === 'eval') {
  await cdp(args.join(' '));
  await delay(500);
  record({expression: args.join(' '), performed: true});
} else if (operation === 'event') {
  const value = await cdp('JSON.stringify(window.__qaEvent ? {id:__qaEvent.event_id,type:__qaEvent.type,seq:__qaEvent.seq,duration:Date.parse(__qaEvent.interval.end_at)-Date.parse(__qaEvent.interval.start_at),spans:__qaEvent.interval.active_spans_ms,active:__qaEvent.progress.active_ms_total,integerActive:Number.isInteger(__qaEvent.progress.active_ms_total)} : null)');
  record({observation: JSON.parse(value)});
} else if (operation === 'lifecycle') {
  await cdp(undefined, 'Page.setWebLifecycleState', {state: args[0]});
  record({state: args[0], performed: true});
} else if (operation === 'crash') {
  try { await cdp(undefined, 'Page.crash', {}); } catch (error) { if (error.message !== 'CDP timeout') throw error; }
  record({renderer_crash_requested: true});
} else if (operation === 'metrics') {
  const [activities, articles, stats] = await Promise.all(['/me/activities?limit=100', '/me/articles?limit=100', '/me/stats'].map(x => web(x)));
  record({activities: activities.items, articles: articles.items, stats});
} else if (operation === 'delete-article') {
  record({articleId: args[0], result: await web('/me/articles/' + args[0] + '/history', 'DELETE')});
} else if (operation === 'delete-history') {
  record({result: await web('/me/history', 'DELETE')});
} else throw new Error('Use through verify-emulator.py');
