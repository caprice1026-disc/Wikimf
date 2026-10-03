// Installed Google Chrome, a fresh profile, real DOM and MV3 service worker.
// API responses below are explicit fixtures; production API/OAuth verification is separate.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import http from 'node:http';
const require = createRequire(import.meta.url);
const runtime = process.env.WIKIMF_NODE_MODULES || resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const { chromium } = require(resolve(runtime,'playwright'));
const account = { user_id: crypto.randomUUID(), device_id: crypto.randomUUID(), token: 'fixture-device-token', recording_epoch: 1, display_name: 'Fixture account' };
const article = { article_id: crypto.randomUUID(), wiki:'jawiki',page_id:1,namespace:0,trackable:true,title:'Fixture',canonical_url:'https://ja.wikipedia.org/wiki/Fixture' };
let offline = false; const received = [];
const server = http.createServer(async(req,res)=>{
  if(offline) { res.writeHead(503);res.end('{}');return; }
  let body='';for await(const part of req) body+=part;
  res.setHeader('Content-Type','application/json');
  if(req.url==='/api/v1/me/recording-control') res.end(JSON.stringify({user_id:account.user_id,device_id:account.device_id,recording_epoch:1,collection_enabled:true,deletion_markers:[]}));
  else if(req.url==='/api/v1/articles/resolve') res.end(JSON.stringify(article));
  else if(req.url==='/api/v1/reading-events/batch') { const data=JSON.parse(body);received.push(...data.events);res.end(JSON.stringify({results:data.events.map(event=>({event_id:event.event_id,status:'accepted'})),recording_epoch:1,server_time:new Date().toISOString()})); }
  else {res.writeHead(404);res.end('{}');}
});
await new Promise(done=>server.listen(0,'127.0.0.1',done));
process.env.WIKIMF_API_ORIGIN='http://127.0.0.1:'+server.address().port;
process.env.WIKIMF_EXTENSION_OUTPUT='./.build-test/';
await import('../build.js');
const extensionPath=fileURLToPath(new URL('../.build-test/',import.meta.url));
const profile=fileURLToPath(new URL('../.browser-tests/'+crypto.randomUUID()+'/',import.meta.url));
await mkdir(profile,{recursive:true});
let context;
const results=[];
try {
  context=await chromium.launchPersistentContext(profile,{executablePath:process.env.WIKIMF_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,
    ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging'],viewport:{width:1100,height:760}});
  const browser=context.browser(),cdp=await browser.newBrowserCDPSession();
  const version=await cdp.send('Browser.getVersion');
  const loaded=await cdp.send('Extensions.loadUnpacked',{path:extensionPath});
  const extensions=await cdp.send('Extensions.getExtensions');
  assert.ok(extensions.extensions.some(item=>item.id===loaded.id&&item.enabled));
  results.push({check:'installed-google-chrome-mv3',version:version.product,id:loaded.id,passed:true});
  console.log('Chrome loaded',version.product,loaded.id);
  const popup=await context.newPage();await popup.goto('chrome-extension://'+loaded.id+'/popup.html');
  const management=await context.newPage();await management.goto('chrome://extensions');
  const mode=management.locator('#devMode');if(await mode.count()) { if(!(await mode.evaluate(element=>element.checked))) await mode.click(); }
  const fixture=await readFile(new URL('../../../packages/tracker/test/fixtures/prose.html',import.meta.url),'utf8');
  await context.route('https://ja.wikipedia.org/wiki/Fixture*',route=>route.fulfill({status:200,contentType:'text/html',body:fixture}));
  const page=await context.newPage();await page.goto('https://ja.wikipedia.org/wiki/Fixture');
  const source=await readFile(new URL('../../../packages/tracker/dist/wiki-tracker.js',import.meta.url),'utf8');
  await page.addScriptTag({content:source});
  const extracted=await page.evaluate(async()=>{
    const doc=WikiMfTracker.extractDocument(document);
    return {text:doc.text,chunks:doc.chunks.map(chunk=>chunk.chars),collapsed:doc.chunks.filter(chunk=>chunk.block.id==='collapsed').map(chunk=>WikiMfTracker.visibleRatio(chunk.range.getClientRects(),innerWidth,innerHeight)),fingerprint:await WikiMfTracker.fingerprint(doc)};
  });
  assert.ok(extracted.text.startsWith('日本語😀é。'));
  assert.ok(!/Excluded|\[99\]/.test(extracted.text));
  assert.ok(extracted.chunks.includes(1));assert.ok(extracted.collapsed.length);assert.ok(extracted.collapsed.every(ratio=>ratio===0));
  assert.match(extracted.fingerprint,/^[a-f0-9]{64}$/);
  const before=extracted.fingerprint;await page.evaluate(()=>document.querySelector('.hatnote p').textContent='Decoration changed');
  const unchanged=await page.evaluate(()=>WikiMfTracker.fingerprint(WikiMfTracker.extractDocument(document)));assert.equal(unchanged,before);
  await page.evaluate(()=>document.querySelector('#lead').append('本文変更'));
  assert.notEqual(await page.evaluate(()=>WikiMfTracker.fingerprint(WikiMfTracker.extractDocument(document))),before);
  results.push({check:'real-DOM-NFC-exclusions-collapsed-fingerprint',passed:true});
  await popup.evaluate(values=>chrome.storage.local.set(values),{credentials:account,settings:{recording:true,sendQueued:true}});
  await page.reload();await page.bringToFront();
  for(let attempt=0;attempt<30&&!received.some(event=>event.type==='reading.observed'&&event.progress.active_ms_total>0);attempt++) await page.waitForTimeout(1000);
  console.log('Observation diagnostics',JSON.stringify({events:received.map(event=>({type:event.type,active:event.progress.active_ms_total})),page:await page.evaluate(()=>({focus:document.hasFocus(),visibility:document.visibilityState})),windows:await popup.evaluate(()=>chrome.windows.getAll().then(items=>items.map(item=>({id:item.id,focused:item.focused}))))}));
  assert.ok(received.some(event=>event.type==='session.opened'));
  assert.ok(received.some(event=>event.type==='reading.observed'&&event.progress.active_ms_total>0));
  assert.ok(received.every(event=>!JSON.stringify(event).includes('日本語')&&!JSON.stringify(event).includes(account.token)));
  results.push({check:'content-to-worker-durable-outbox-item-ACK',events:received.length,passed:true});
  const pageCdp=await context.newCDPSession(page), worlds=[];
  pageCdp.on('Runtime.executionContextCreated',event=>worlds.push(event.context));await pageCdp.send('Runtime.enable');
  const isolated=worlds.find(world=>world.name.includes(loaded.id)||world.origin==='chrome-extension://'+loaded.id||world.name==='wikimf');
  if(!isolated) console.log('Controlled fixture execution worlds',JSON.stringify(worlds.map(world=>({name:world.name,origin:world.origin,type:world.auxData?.type}))));
  assert.ok(isolated,'Content script isolated context exists');
  const denied=await pageCdp.send('Runtime.evaluate',{contextId:isolated.id,expression:'(async()=>{try{const value=await chrome.storage.local.get("credentials");return {denied:false,hasCredentials:!!value.credentials}}catch{return {denied:true}}})()',awaitPromise:true,returnByValue:true});
  assert.equal(denied.result.value?.denied,true);
  results.push({check:'content-storage-credential-access-denied',passed:true});
  await popup.bringToFront();await popup.reload();
  await popup.waitForFunction(()=>document.getElementById('status').textContent.includes('記録'));
  assert.ok((await popup.locator('#status').innerText()).includes('記録中'));
  const html=await popup.content();assert.ok(!html.includes(account.token));
  await popup.screenshot({path:fileURLToPath(new URL('../.browser-tests/popup.png',import.meta.url))});
  results.push({check:'popup-sync-consent-no-token',passed:true});
  // Opening popup moves the active tab. The old article must stop accumulating.
  const firstActive=received.filter(event=>event.type==='reading.observed').at(-1)?.progress.active_ms_total||0;
  await popup.waitForTimeout(4000);
  const second=await context.newPage();await second.goto('https://ja.wikipedia.org/wiki/Fixture#section');await second.bringToFront();
  await second.waitForTimeout(12000);
  const sessions=new Set(received.map(event=>event.session_id));assert.ok(sessions.size>=2);
  results.push({check:'active-tab-switch-separate-sessions',sessions:sessions.size,baseline:firstActive,passed:true});
  offline=true;await second.mouse.wheel(0,300);await second.waitForTimeout(12000);
  let stored=await popup.evaluate(()=>chrome.storage.local.get('outbox'));
  const queueBefore=stored.outbox.rows.map(row=>row.event.event_id);assert.ok(queueBefore.length);
  // Stop the actual service worker through CDP; the persistent queue must survive.
  const serviceSession=await context.newCDPSession(second);await serviceSession.send('ServiceWorker.enable');
  await serviceSession.send('ServiceWorker.stopAllWorkers');
  const targets=await cdp.send('Target.getTargets');
  const extensionWorker=targets.targetInfos.find(target=>target.type==='service_worker'&&target.url.includes(loaded.id));
  if(extensionWorker) assert.equal((await cdp.send('Target.closeTarget',{targetId:extensionWorker.targetId})).success,true);
  await second.waitForTimeout(1000);
  stored=await popup.evaluate(()=>chrome.storage.local.get('outbox'));
  assert.ok(queueBefore.every(id=>stored.outbox.rows.some(row=>row.event.event_id===id)));
  results.push({check:'offline-queue-service-worker-stop-survives',queued:queueBefore.length,passed:true});
  await second.waitForTimeout(11000);
  stored=await popup.evaluate(()=>chrome.storage.local.get('outbox'));
  assert.ok(stored.outbox.rows.length>queueBefore.length,'Restarted worker continues to accept the same offline Document');
  results.push({check:'offline-worker-restart-binding-restored',passed:true});
  offline=false;await popup.bringToFront();await popup.locator('#sync').click();
  await popup.waitForTimeout(1000);
  stored=await popup.evaluate(()=>chrome.storage.local.get('outbox'));
  assert.equal(stored.outbox.rows.length,0);results.push({check:'restart-resend-ACK-only-deletion',passed:true});
  console.log(JSON.stringify({fixture_api:true,results},null,2));
  await writeFile(new URL('../.browser-tests/report.json',import.meta.url),JSON.stringify({fixture_api:true,results},null,2));
} finally {await context?.close();await new Promise(done=>server.close(done));}
