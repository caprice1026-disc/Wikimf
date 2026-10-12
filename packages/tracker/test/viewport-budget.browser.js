// Real browser geometry: collapsed prose stays in the denominator, never in every tick's scan.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
await import('../build.js');
const require=createRequire(import.meta.url);
const {chromium}=require(resolve(process.env.WIKIMF_NODE_MODULES||'apps/dashboard/node_modules','playwright'));
const browser=await chromium.launch({executablePath:process.env.WIKIMF_CHROME,headless:true});
try {
  const page=await browser.newPage();
  const html=`<div id="mw-content-text"><div class="mw-parser-output"><div class="mw-collapsible-content" aria-hidden="true" style="display:none"><p>${'a'.repeat(24000)}</p></div><p>${'b'.repeat(200)}</p></div></div>`;
  await page.route('https://en.wikipedia.org/**',r=>r.fulfill({contentType:'text/html',body:html}));
  await page.goto('https://en.wikipedia.org/wiki/Fixture');
  await page.evaluate(()=>{
    window.rectCalls=0;const original=Range.prototype.getClientRects;
    Range.prototype.getClientRects=function(){window.rectCalls++;return original.call(this)};
    window.WKMF_CONTEXT={article:{article_id:crypto.randomUUID(),wiki:'enwiki',page_id:1},deviceId:crypto.randomUUID(),sessionId:crypto.randomUUID(),epoch:1,active:true};
    window.events=[];window.WikimfObservation={postMessage:s=>window.events.push(JSON.parse(s))};
  });
  await page.addScriptTag({content:await readFile(new URL('../dist/android-tracker.js',import.meta.url),'utf8')});
  await page.waitForFunction(()=>window.events.some(e=>e.type==='session.opened'));
  await page.waitForTimeout(1000);await page.evaluate(()=>{window.rectCalls=0});
  await page.waitForTimeout(650);
  const result=await page.evaluate(()=>({rectCalls:window.rectCalls,chars:window.events[0].document.text_chars,chunks:window.events[0].document.chunk_chars.length}));
  console.log(JSON.stringify({browser:await browser.version(),...result}));
  assert.equal(result.chars,24200);assert.equal(result.chunks,121);
  assert.ok(result.rectCalls<60,'Collapsed chunks must stay in the denominator without scanning all 121 ranges every tick');
} finally {await browser.close()}
