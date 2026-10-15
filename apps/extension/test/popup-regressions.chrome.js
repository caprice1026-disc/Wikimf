// Actual installed Chrome DOM, explicit runtime fixtures; no account or durable credential is created.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
const require=createRequire(import.meta.url);
const {chromium}=require(resolve(process.env.WIKIMF_NODE_MODULES,'playwright'));
const browser=await chromium.launch({channel:'chrome',headless:true});
const context=await browser.newContext({viewport:{width:360,height:900}});
const output=new URL('../.browser-tests/',import.meta.url);await mkdir(output,{recursive:true});
const results=[];
const state={linked:true,display_name:'Fixture account',recording:false,recording_enabled:false,sendQueued:false,queued:0,rejected:0,discarded:0,sync:'idle',pairing:null,current_article:null,dashboard_url:'https://dashboard.fixture'};
async function pageFor(overrides={},options={}) {
  const page=await context.newPage();
  await page.addInitScript(({initial,options})=>{
    globalThis.qa={state:initial,options,calls:[],release:null};
    Object.defineProperty(globalThis,'chrome',{configurable:true,value:{runtime:{sendMessage:async message=>{
      const q=globalThis.qa;q.calls.push(message.type);
      if(message.type==='status')return structuredClone(q.state);
      if(message.type==='pair.poll'&&q.options.expired){q.state.pairing=null;q.options.expired=false;return {expired:true};}
      if(message.type==='recording'){
        if(q.options.rejectRecording)return {error:'server_paused'};
        q.state.recording=message.enabled;q.state.sendQueued=message.sendQueued;
      }
      if(message.type==='sync'){
        if(q.options.delaySync)await new Promise(done=>{q.release=done;});
        q.state.queued=0;q.state.sync='synced';
      }
      if(message.type==='discard.preview')return {queued:q.state.queued,event_ids:Array.from({length:q.state.queued},(_,i)=>'event-'+i),device_id:'fixture-device',user_id:'fixture-user'};
      if(message.type==='discard')q.state.queued=0;
      return {};
    }}}});
  },{initial:{...state,...overrides},options});
  await page.route('http://popup.fixture/**',async route=>{
    const name=new URL(route.request().url()).pathname.split('/').pop();
    assert.ok(['popup.html','popup.js','popup.css'].includes(name));
    await route.fulfill({body:await readFile(new URL('../src/'+name,import.meta.url)),contentType:name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':'text/html'});
  });
  await page.goto('http://popup.fixture/popup.html');
  await page.waitForFunction(()=>globalThis.qa.calls.includes('status'));
  return page;
}
async function check(name,test){let page;try{page=await test();results.push({check:name,passed:true});}catch(error){results.push({check:name,passed:false,error:String(error.message).slice(0,240)});}finally{await page?.close();}}
try {
  await check('unlinked-shows-only-relevant-actions',async()=>{
    const page=await pageFor({linked:false});
    for(const id of ['recording','sendQueued','sync','discard','logout','logoutDiscard'])assert.equal(await page.locator('#'+id).isVisible(),false,id);
    assert.equal(await page.locator('#pair').isVisible(),true);
    assert.equal(await page.locator('#article').isVisible(),false);
    await page.screenshot({path:resolve('apps/extension/.browser-tests/popup-unlinked-current.png')});return page;
  });
  await check('recording-setting-is-not-a-live-measurement-claim',async()=>{
    const page=await pageFor({recording:true,recording_enabled:true});
    const status=await page.locator('#status').innerText();assert.match(status,/設定ON/);assert.doesNotMatch(status,/記録中|計測中/);
    assert.equal(await page.locator('#pair').isVisible(),false);return page;
  });
  await check('remaining-queue-is-not-all-synced',async()=>{
    const page=await pageFor({sync:'synced',queued:6});assert.match(await page.locator('#status').innerText(),/残り|未送信/);return page;
  });
  await check('failed-toggle-rolls-back-and-error-survives-background-poll',async()=>{
    const page=await pageFor({}, {rejectRecording:true});await page.locator('#recording').click();
    await page.waitForFunction(()=>document.getElementById('error').textContent.length>0);
    assert.equal(await page.locator('#recording').isChecked(),false);
    const message=await page.locator('#error').innerText();
    await page.waitForFunction(()=>globalThis.qa.calls.includes('pair.poll'),null,{timeout:15000});
    assert.equal(await page.locator('#error').innerText(),message);return page;
  });
  await check('busy-operation-disables-repeated-actions',async()=>{
    const page=await pageFor({queued:8},{delaySync:true});await page.locator('#sync').click();
    await page.waitForFunction(()=>globalThis.qa.release!==null);
    try {assert.equal(await page.locator('#sync').isDisabled(),true);assert.match(await page.locator('#status').innerText(),/処理中|同期中/);}
    finally {await page.evaluate(()=>globalThis.qa.release());}
    return page;
  });
  await check('expired-pairing-has-an-explicit-next-action',async()=>{
    const page=await pageFor({linked:false,pairing:{user_code:'ABCDEFGH',expires_at:new Date(Date.now()+300000).toISOString()}},{expired:true});
    await page.waitForFunction(()=>globalThis.qa.calls.includes('pair.poll'),null,{timeout:15000});
    assert.match(await page.locator('#error').innerText(),/期限/);return page;
  });
  await check('discard-confirmation-names-count-and-cancel-retains-data',async()=>{
    const page=await pageFor({queued:8,rejected:1});
    if(await page.locator('#dataOperations').count())await page.locator('#dataOperations').evaluate(element=>element.open=true);
    let message='';page.on('dialog',async dialog=>{message=dialog.message();await dialog.dismiss();});
    await page.locator('#discard').click();await page.waitForFunction(()=>globalThis.qa.calls.includes('discard.preview'));
    await page.waitForFunction(()=>globalThis.qa.calls.includes('discard.preview')&&document.activeElement);
    assert.match(message,/8/);assert.match(message,/戻せ|復元/);
    assert.equal(await page.evaluate(()=>globalThis.qa.state.queued),8);
    assert.equal(await page.evaluate(()=>globalThis.qa.calls.includes('discard')),false);return page;
  });
  await check('current-article-opens-the-existing-safe-dashboard-detail',async()=>{
    const id='40000000-0000-4000-8000-000000000001';
    const page=await pageFor({current_article:{article_id:id,title:'Fixture article',state:'partial',evidence:'inferred'}});
    assert.equal(await page.locator('#articleDetail').getAttribute('href'),'https://dashboard.fixture/app/articles/'+id);
    assert.equal(await page.locator('#articleDetail').getAttribute('target'),'_blank');return page;
  });
  await check('keyboard-can-set-recording-and-expand-details',async()=>{
    const page=await pageFor({queued:8});
    await page.locator('#recording').focus();await page.keyboard.press('Space');
    await page.waitForFunction(()=>globalThis.qa.state.recording===true);
    await page.keyboard.press('Tab');assert.equal(await page.locator('#sendQueued').evaluate(element=>element===document.activeElement),true);
    await page.locator('#dataOperations>summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#dataOperations').evaluate(element=>element.open),true);
    await page.keyboard.press('Enter');assert.equal(await page.locator('#dataOperations').evaluate(element=>element.open),false);
    await page.locator('#help>summary').focus();await page.keyboard.press('Enter');
    assert.equal(await page.locator('#help').evaluate(element=>element.open),true);return page;
  });
  await check('authentication-and-age-guidance-distinguishes-delivery-from-renewal',async()=>{
    const page=await pageFor({sync:'device_revoked',queued:8,expiry:{near_count:2,expired_count:0,unknown_count:0,remaining_ms:7200000,clock_anomaly:false}});
    assert.match(await page.locator('#status').innerText(),/認証・権限/);
    assert.doesNotMatch(await page.locator('#status').innerText(),/連携が失効/);
    await page.locator('#help>summary').click();
    const help=await page.locator('#help').innerText();
    assert.match(help,/送信に使える期限は最大7日/);assert.match(help,/有効な制御確認/);
    assert.match(help,/元の認証が再び有効/);assert.match(help,/復旧機能は現在ありません/);
    assert.match(await page.locator('#expiryNotice').innerText(),/送信期限/);
    assert.match(await page.locator('#expiryDetails').innerText(),/認証・収集設定により送信できない/);
    return page;
  });
  await check('two-hundred-percent-css-zoom-has-no-horizontal-overflow',async()=>{
    const page=await pageFor({queued:8,expiry:{near_count:3,expired_count:0,unknown_count:0,remaining_ms:7200000,clock_anomaly:false}});await page.setViewportSize({width:360,height:1000});
    await page.evaluate(()=>{document.documentElement.style.zoom='2';document.getElementById('help').open=true;});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
    await page.screenshot({path:resolve('apps/extension/.browser-tests/popup-zoom-current.png'),fullPage:true});return page;
  });
  await check('approaching-expiry-is-short-and-details-expansion-has-no-action',async()=>{
    const page=await pageFor({queued:4,expiry:{near_count:2,expired_count:0,unknown_count:0,remaining_ms:7200000,clock_anomaly:false}});
    assert.match(await page.locator('#expiryNotice').innerText(),/未送信2件.*最短 約2時間/);
    assert.equal(await page.locator('#help').evaluate(element=>element.open),false);
    assert.equal(await page.locator('#expiryDetails').isVisible(),false);
    assert.equal(await page.locator('#sync').isVisible(),true);
    assert.equal(await page.locator('#dataOperations').evaluate(element=>element.open),false);
    await page.screenshot({path:resolve('apps/extension/.browser-tests/expiry-near.png')});
    const before=await page.evaluate(()=>structuredClone(globalThis.qa.state));
    await page.locator('#help>summary').click();
    assert.match(await page.locator('#expiryDetails').innerText(),/24時間以内: 2件/);
    assert.match(await page.locator('#expiryDetails').innerText(),/端末時刻.*目安/);
    assert.deepEqual(await page.evaluate(()=>globalThis.qa.state),before);
    assert.ok((await page.evaluate(()=>globalThis.qa.calls)).every(type=>['status','pair.poll'].includes(type)));
    await page.screenshot({path:resolve('apps/extension/.browser-tests/expiry-near-details.png'),fullPage:true});return page;
  });
  await check('empty-unlinked-and-far-future-expiry-do-not-add-a-warning',async()=>{
    let last;
    for(const overrides of [{queued:0,expiry:{near_count:1,remaining_ms:0}},{linked:false,queued:1,expiry:{near_count:1,remaining_ms:0}},
      {queued:1,expiry:{near_count:0,expired_count:0,unknown_count:0,remaining_ms:null}}]){
      await last?.close();last=await pageFor(overrides);
      assert.equal(await last.locator('#expiryNotice').isVisible(),false);
      await last.locator('#help>summary').click();assert.equal(await last.locator('#expiryDetails').isVisible(),false);
    }
    return last;
  });
  await check('expired-and-unknown-rows-show-no-invented-countdown',async()=>{
    const page=await pageFor({queued:3,expiry:{near_count:0,expired_count:2,unknown_count:1,remaining_ms:null,clock_anomaly:false}});
    assert.equal(await page.locator('#expiryNotice').isVisible(),false);
    await page.locator('#help>summary').click();const details=await page.locator('#expiryDetails').innerText();
    assert.match(details,/過ぎた記録: 2件/);assert.match(details,/確認できない記録: 1件/);assert.doesNotMatch(details,/最短|約\d/);
    await page.screenshot({path:resolve('apps/extension/.browser-tests/expiry-expired-unknown.png'),fullPage:true});return page;
  });
  await check('clock-anomaly-is-unknown-and-exact-deadline-is-less-than-a-minute',async()=>{
    const page=await pageFor({queued:1,expiry:{near_count:0,expired_count:0,unknown_count:1,remaining_ms:null,clock_anomaly:true}});
    assert.equal(await page.locator('#expiryNotice').isVisible(),false);
    await page.locator('#help>summary').click();assert.match(await page.locator('#expiryDetails').innerText(),/端末時計のずれ/);
    await page.evaluate(()=>{globalThis.qa.state.expiry={near_count:1,expired_count:0,unknown_count:0,remaining_ms:0,clock_anomaly:false};});
    await page.waitForFunction(()=>document.getElementById('expiryNotice').textContent.includes('1分未満'),null,{timeout:12000});
    assert.doesNotMatch(await page.locator('#expiryDetails').innerText(),/過ぎた記録/);return page;
  });
  await check('ACK-to-empty-hides-expiry-on-background-refresh-without-sending',async()=>{
    const page=await pageFor({queued:1,expiry:{near_count:1,expired_count:0,unknown_count:0,remaining_ms:60000,clock_anomaly:false}});
    assert.equal(await page.locator('#expiryNotice').isVisible(),true);
    await page.evaluate(()=>{globalThis.qa.state.queued=0;});
    await page.waitForFunction(()=>document.getElementById('expiryNotice').hidden,null,{timeout:12000});
    assert.ok((await page.evaluate(()=>globalThis.qa.calls)).every(type=>['status','pair.poll'].includes(type)));return page;
  });
  await writeFile(new URL(process.env.WIKIMF_POPUP_BEFORE==='1'?'popup-before-results.json':'popup-results.json',output),JSON.stringify(results,null,2));
  console.log(JSON.stringify(results));
  if(process.env.WIKIMF_POPUP_BEFORE!=='1')assert.ok(results.every(result=>result.passed),'Popup regression failed');
}finally{await context.close();await browser.close();}
