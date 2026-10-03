// Opt-in live DOM compatibility check: actual installed Chrome, no account/session.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require=createRequire(import.meta.url);
const runtime=process.env.WIKIMF_NODE_MODULES||resolve(homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules');
const {chromium}=require(resolve(runtime,'playwright'));
const output=new URL('../../../apps/extension/.browser-tests/',import.meta.url);await mkdir(output,{recursive:true});
const profile=new URL('live-'+crypto.randomUUID()+'/',output);
const context=await chromium.launchPersistentContext(fileURLToPath(profile),{executablePath:process.env.WIKIMF_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
try {
  const source=await readFile(new URL('../dist/wiki-tracker.js',import.meta.url),'utf8'),results=[];
  for(const url of ['https://ja.wikipedia.org/wiki/地球','https://en.wikipedia.org/wiki/Earth']) {
    const page=await context.newPage();await page.goto(url,{waitUntil:'domcontentloaded',timeout:60000});await page.addScriptTag({content:source});
    const result=await page.evaluate(async()=>{
      const begin=performance.now(),extracted=WikiMfTracker.extractDocument(document);
      return {url:location.origin+location.pathname,status:extracted.status,reason:extracted.reason||null,text_chars:extracted.chunks.reduce((sum,chunk)=>sum+chunk.chars,0),
        chunks:extracted.chunks.length,fingerprint:await WikiMfTracker.fingerprint(extracted),extraction_ms:Math.round((performance.now()-begin)*100)/100,
        excluded_infobox_chunks:extracted.chunks.filter(chunk=>chunk.block.closest('.infobox')).length,ordinary_colon:WikiMfTracker.articleLocation('https://en.wikipedia.org/wiki/Star_Trek:_Voyager')!==null};
    });
    assert.equal(result.status,'ok');assert.ok(result.text_chars>1000);assert.ok(result.chunks>5);assert.equal(result.excluded_infobox_chunks,0);assert.equal(result.ordinary_colon,true);results.push(result);await page.close();
  }
  const report={browser:context.browser().version(),live_wikipedia:true,tracker:'prose-v1',results};
  await writeFile(new URL('live-wikipedia.json',output),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await context.close();}
