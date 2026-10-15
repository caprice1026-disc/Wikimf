// Real Chrome, synthetic GET-only API: list/detail round trips and delayed rows.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
const base=process.env.DASHBOARD_URL || 'http://127.0.0.1:4173';
const baseline=process.env.WIKIMF_UX_BASELINE==='1';
const browser=await chromium.launch({channel:'chrome',headless:true});
const results=[];
const rows=Array.from({length:50},(_,i)=>{
  const id='40000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  const article={article_id:id,wiki:'jawiki',page_id:1000+i,title:`Fixture article ${String(i+1).padStart(2,'0')}`,canonical_url:'https://ja.wikipedia.org/wiki/Fixture'};
  return {article,article_id:id,effective_state:'partial',inferred_state:'partial',manual_state:null,evidence:'inferred',active_ms:60000,estimated_read_chars:1200,coverage:.5,last_read_at:'2026-10-13T00:00:00Z',activity_count:1,activities:[]};
});
try {
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:900}});
    const page=await context.newPage();const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/api/v1/**',async route=>{
      assert.equal(route.request().method(),'GET','This fixture must never mutate any account');
      const url=new URL(route.request().url()),path=url.pathname.replace('/api/v1','');let data={};
      if(path==='/me')data={user_id:'fixture-user',display_name:'Reader fixture',csrf_token:'synthetic-csrf',timezone:'Asia/Tokyo',collection_enabled:false};
      else if(path==='/me/privacy')data={collection_enabled:false,profile_public:false,publish_total_time:false,publish_achievements:false,timezone:'Asia/Tokyo',display_name:'Reader fixture'};
      else if(path==='/me/articles') {
        await new Promise(done=>setTimeout(done,600));
        data={items:rows.filter(row=>!url.searchParams.get('query')||row.article.title.includes(url.searchParams.get('query'))),next_cursor:null};
      } else if(path==='/me/activities') {
        await new Promise(done=>setTimeout(done,600));
        data={items:url.searchParams.get('source')?[{...rows[0],session_id:'fixture-session',session_started_at:'2026-10-13T00:00:00Z',source:'android_reader',state:'partial',estimated_read_chars:1200}]:[],next_cursor:null};
      } else if(path.startsWith('/me/articles/'))data=rows.find(row=>path.endsWith(row.article_id));
      else throw new Error('Unexpected synthetic API path: '+path);
      await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
    });
    async function check(name,action) {try{await action();results.push({width,check:name,passed:true});}catch(error){results.push({width,check:name,passed:false,error:String(error.message).slice(0,500)});}}
    const list='/app/library?query=Fixture&wiki=jawiki&state=partial&sort=title';
    async function openArticle() {
      await page.goto(base+list);await page.locator('.library-row').last().waitFor();
      const target=page.locator('.library-row .article-title').nth(24);await target.scrollIntoViewIfNeeded();
      const y=await page.evaluate(()=>scrollY);assert.ok(y>500);
      await target.click();await page.getByRole('heading',{name:rows[24].article.title,exact:true}).waitFor();
      assert.ok(await page.evaluate(()=>scrollY<10),'new detail starts at the top');return y;
    }
    await check('explicit-return-keeps-all-filters-and-scroll',async()=>{
      const y=await openArticle();
      assert.equal(await page.locator('.back-link').getAttribute('href'),list);
      await page.locator('.back-link').click();await page.locator('.library-row').last().waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,list);
      await page.waitForFunction(expected=>Math.abs(scrollY-expected)<8,y,{timeout:5000}).catch(async()=>{
        throw new Error('Explicit return scroll mismatch: '+JSON.stringify({expected:y,actual:await page.evaluate(()=>scrollY)}));
      });
      assert.equal(await page.getByLabel('自分の Library を検索').inputValue(),'Fixture');
      assert.equal(await page.getByLabel('読書状態').inputValue(),'partial');
      assert.equal(await page.getByLabel('並び順').inputValue(),'title');
    });
    await check('browser-back-restores-after-delayed-list-load',async()=>{
      const y=await openArticle();await page.goBack();await page.locator('.library-row').last().waitFor();
      assert.equal(new URL(page.url()).pathname+new URL(page.url()).search,list);
      await page.waitForFunction(expected=>Math.abs(scrollY-expected)<8,y,{timeout:5000});
    });
    await check('empty-library-can-clear-all-filters',async()=>{
      await page.goto(base+'/app/library?query=NoMatch&wiki=jawiki&state=completed&sort=title');
      await page.getByRole('heading',{name:'条件に合う記事がありません。'}).waitFor();
      await page.getByRole('button',{name:'検索・絞り込みを解除',exact:true}).click({timeout:2000});
      await page.locator('.library-row').last().waitFor();assert.equal(new URL(page.url()).search,'');
      assert.equal(await page.getByLabel('自分の Library を検索').inputValue(),'');
    });
    await check('activity-return-and-reset-cover-source-and-language',async()=>{
      const list='/app/activity?source=android_reader&wiki=jawiki';
      await page.goto(base+list);await page.locator('.reading-row .article-title').click();
      await page.getByRole('heading',{name:rows[0].article.title,exact:true}).waitFor();
      assert.equal(await page.locator('.back-link').getAttribute('href'),list);
      await page.locator('.back-link').click();await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();
      await page.getByRole('button',{name:'検索・絞り込みを解除',exact:true}).click({timeout:2000});
      assert.equal(new URL(page.url()).search,'');
      assert.equal(await page.getByLabel('計測元').inputValue(),'');assert.equal(await page.getByLabel('言語').inputValue(),'');
    });
    await check('direct-detail-has-safe-fallback-and-no-overflow',async()=>{
      await page.goto(base+'/app/articles/'+rows[0].article_id);await page.getByRole('heading',{name:rows[0].article.title,exact:true}).waitFor();
      assert.equal(await page.locator('.back-link').getAttribute('href'),'/app/library');
      assert.equal(await page.evaluate(()=>document.body.scrollWidth>innerWidth),false);
      assert.deepEqual(errors,[]);
    });
    await context.close();
  }
  await mkdir(new URL('../output/',import.meta.url),{recursive:true});
  await writeFile(new URL(baseline?'../output/heavy-user-before.json':'../output/heavy-user-browser.json',import.meta.url),JSON.stringify({fixture:'synthetic-get-only',results},null,2));
  console.log(JSON.stringify(results));
  if(!baseline)assert.ok(results.every(result=>result.passed),'Heavy-user regression failed');
} finally {await browser.close();}
