// Actual FastAPI + PostgreSQL QA server. Identities and article metadata are synthetic.
// Read the ignored fixture file internally; never print tokens, cookies or subjects.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
const require=createRequire(import.meta.url),runtime=process.env.WIKIMF_NODE_MODULES||resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(resolve(runtime,'playwright'));
const fixture=JSON.parse(await readFile(process.env.WIKIMF_BACKEND_FIXTURE||new URL('../../../.tmp/backend-smoke.json',import.meta.url),'utf8'));
const origin=new URL(fixture.api_origin).origin;
assert.ok(['localhost','127.0.0.1'].includes(new URL(origin).hostname),'QA server must be loopback');
const get=async path=>{const response=await fetch(origin+'/api/v1'+path,{headers:{Authorization:'Bearer '+fixture.device.token}});assert.equal(response.status,200);return response.json();};
const baseline=await get('/me/stats');
process.env.WIKIMF_API_ORIGIN=origin;process.env.WIKIMF_DASHBOARD_ORIGIN=new URL(fixture.dashboard_origin).origin;process.env.WIKIMF_EXTENSION_OUTPUT='./.build-backend/';await import('../build.js');
const profile=fileURLToPath(new URL('../.browser-tests/backend-'+crypto.randomUUID()+'/',import.meta.url));await mkdir(profile,{recursive:true});
const context=await chromium.launchPersistentContext(profile,{executablePath:process.env.WIKIMF_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,ignoreDefaultArgs:['--disable-extensions'],args:['--enable-unsafe-extension-debugging']});
try {
  const cdp=await context.browser().newBrowserCDPSession(),loaded=await cdp.send('Extensions.loadUnpacked',{path:fileURLToPath(new URL('../.build-backend/',import.meta.url))});
  let worker=context.serviceWorkers().find(item=>item.url().includes(loaded.id));if(!worker) worker=await context.waitForEvent('serviceworker');
  await worker.evaluate(()=>{
    globalThis.__wikimfQa={acks:[],sessions:[]};const original=globalThis.fetch;
    globalThis.fetch=async(...args)=>{
      const response=await original(...args);
      if(String(args[0]).endsWith('/reading-events/batch')) {
        const sent=JSON.parse(args[1].body),result=await response.clone().json();
        globalThis.__wikimfQa.sessions.push(...sent.events.map(event=>event.session_id));
        globalThis.__wikimfQa.acks.push(...(result.results||[]).map(item=>({status:item.status,code:item.code||null})));
      }
      return response;
    };
  });
  const popup=await context.newPage();await popup.goto('chrome-extension://'+loaded.id+'/popup.html');
  // Exercise the real device-link start/pending/approval/exchange path. The Web
  // session is a synthetic QA identity; no OAuth provider login is simulated.
  await context.addCookies([fixture.cookie]);
  const started=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'pair.start'}));assert.ok(started.user_code);assert.equal(started.error,undefined);
  const pending=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'pair.poll'}));assert.equal(pending.pending,true);
  const pairing=await popup.evaluate(()=>chrome.storage.local.get('pairing').then(value=>({link_id:value.pairing.link_id,user_code:value.pairing.user_code})));
  const approval=await fetch(origin+'/api/v1/device-links/'+pairing.link_id+'/approve',{method:'POST',headers:{'Content-Type':'application/json','Cookie':fixture.cookie.name+'='+fixture.cookie.value,'X-CSRF-Token':fixture.csrf},body:JSON.stringify({user_code:pairing.user_code})});assert.equal(approval.status,200);
  await popup.waitForTimeout(6000);
  const exchanged=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'pair.poll'}));assert.equal(exchanged.error,undefined);
  const linked=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'status'}));assert.equal(linked.linked,true);
  const enabled=await popup.evaluate(()=>chrome.runtime.sendMessage({type:'recording',enabled:true,sendQueued:true}));assert.equal(enabled.recording,true);
  const html=await readFile(new URL('../../../packages/tracker/test/fixtures/prose.html',import.meta.url),'utf8');
  await context.route('https://ja.wikipedia.org/wiki/Fixture',route=>route.fulfill({status:200,contentType:'text/html',body:html}));
  const page=await context.newPage();await page.goto('https://ja.wikipedia.org/wiki/Fixture');await page.bringToFront();
  let observations;
  for(let attempt=0;attempt<40;attempt++) {
    await page.waitForTimeout(1000);observations=await worker.evaluate(()=>globalThis.__wikimfQa);
    if(observations.acks.length>=2) break;
  }
  assert.ok(observations.acks.length>=2);assert.ok(observations.acks.every(item=>['accepted','duplicate'].includes(item.status)),JSON.stringify(observations.acks));
  const activities=await get('/me/activities?limit=100'),sessionIds=new Set(observations.sessions);
  const own=activities.items.filter(item=>sessionIds.has(item.session_id));assert.ok(own.length);assert.ok(own.some(item=>item.active_ms>=1000));
  assert.ok(own.every(item=>item.source==='chrome_extension'&&item.article_id===fixture.article_id&&item.measurement_status==='ok'));
  const after=await get('/me/stats');assert.ok(after.activity.active_ms>baseline.activity.active_ms);
  const stored=await popup.evaluate(()=>chrome.storage.local.get(['outbox','syncStatus']));assert.equal(stored.outbox.rows.length,0);assert.equal(stored.outbox.quarantine.length,0);
  const report={browser:context.browser().version(),extension_id:loaded.id,actual_fastapi_postgres:true,synthetic_identity_and_metadata:true,
    device_pairing_start_pending_web_approval_exchange:true,
    strict_item_ACK:observations.acks,session_count:own.length,active_ms_added:after.activity.active_ms-baseline.activity.active_ms,article_match:true,persistent_queue_remaining:stored.outbox.rows.length};
  await writeFile(new URL('../.browser-tests/backend-report.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await context.close();}
