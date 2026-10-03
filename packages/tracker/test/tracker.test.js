import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, articleLocation, codepointCount, chunkSizes, excludedElement, visibleRatio, viewportChunks, inferState, ReadingSession } from '../tracker.js';
const time = Date.UTC(2026,9,4,0);
const uuid = () => crypto.randomUUID();
function session(overrides = {}) {
  return new ReadingSession({ article: { article_id: uuid(), wiki: 'jawiki', page_id: 1 }, deviceId: uuid(),
    source: 'chrome_extension', epoch: 1, now: time, mono: 0,
    document: { fingerprint: 'a'.repeat(64), extractor_version: POLICY.extractor, observed_revision_id: null, text_chars: 400, chunk_chars: [200,200] }, ...overrides });
}
test('URL boundary excludes credentials, lookalikes, old revisions, and fragments do not change article identity', () => {
  assert.deepEqual(articleLocation('https://ja.wikipedia.org/wiki/A_B#Section'), { wiki: 'jawiki', title: 'A B' });
  assert.deepEqual(articleLocation('https://en.wikipedia.org/w/index.php?title=Earth&action=view'), { wiki: 'enwiki', title: 'Earth' });
  assert.deepEqual(articleLocation('https://en.wikipedia.org/wiki/Star_Trek:_Voyager'), { wiki: 'enwiki', title: 'Star Trek: Voyager' });
  assert.deepEqual(articleLocation('https://en.wikipedia.org/w/index.php?curid=123'), { wiki: 'enwiki', page_id:123 });
  for (const url of ['http://ja.wikipedia.org/wiki/A','https://ja.wikipedia.org.example.com/wiki/A','https://user@ja.wikipedia.org/wiki/A','https://ja.wikipedia.org:8443/wiki/A','https://ja.wikipedia.org/wiki/A?oldid=1','https://en.wikipedia.org/wiki/A?diff=2','https://en.wikipedia.org/wiki/A?action=edit','https://en.wikipedia.org/wiki/A?veaction=edit','https://en.wikipedia.org/wiki/A?title=B','https://en.wikipedia.org/w/index.php?title=A&title=B','https://en.wikipedia.org/wiki/%zz']) assert.equal(articleLocation(url), null);
});
test('NFC Unicode code points, whitespace excluded, punctuation included', () => {
  assert.equal(codepointCount(' A\nか\t😀e\u0301。 '), 5);
  assert.deepEqual(chunkSizes('😀'.repeat(401)), [200,200,1]);
});
test('aria-hidden collapsed body remains in denominator while hidden decoration is excluded',()=>{
  const folded={closest:selector=>selector.includes('.collapsible-block')?folded:null};
  const decoration={closest:()=>null};
  const element=hidden=>({closest:selector=>selector==='[aria-hidden="true"]'?hidden:null});
  assert.equal(excludedElement(element(folded)),false);assert.equal(excludedElement(element(decoration)),true);
});
test('chunk intersection uses actual Range rectangles and empty/collapsed text is uncovered', () => {
  assert.equal(visibleRatio([{left:0,top:0,right:200,bottom:100,width:200,height:100}],100,100),.5);
  assert.equal(visibleRatio([],100,100),0);
  assert.equal(visibleRatio([{left:0,top:200,right:100,bottom:300,width:100,height:100}],100,100),0);
});
test('a 5000-chunk paragraph measures only the viewport neighbourhood',()=>{
  let measured=0;
  const chunks=Array.from({length:5000},(_,id)=>({id,range:{getBoundingClientRect:()=>{measured++;return {top:id*10-10000,bottom:id*10-9990};}}}));
  const visible=viewportChunks(chunks,100);
  assert.ok(visible.length<20);assert.ok(measured<30);assert.ok(visible.some(chunk=>chunk.id===1000));
});
test('covered chunks require two active seconds and count only once; jumps never cover unseen chunks', () => {
  const reading = session(); const opened = reading.event('session.opened');
  assert.equal(opened.seq,0); assert.deepEqual(opened.interval.active_spans_ms,[]);
  reading.tick({ now: time+1000, mono:1000, active:true, ratios:[.5,0] }); assert.deepEqual([...reading.covered],[]);
  reading.tick({ now: time+2000, mono:2000, active:true, ratios:[.5,0] }); assert.deepEqual([...reading.covered],[]);
  reading.tick({ now: time+3000, mono:3000, active:true, ratios:[.5,0] }); assert.deepEqual([...reading.covered],[0]);
  reading.tick({ now: time+4000, mono:4000, active:true, ratios:[0,1] });
  reading.tick({ now: time+5000, mono:5000, active:true, ratios:[0,1] }); assert.deepEqual([...reading.covered],[0]);
  reading.tick({ now: time+6000, mono:6000, active:true, ratios:[0,1] }); assert.deepEqual([...reading.covered],[0,1]);
  const event = reading.event('reading.observed'); assert.equal(event.progress.active_ms_total,6000); assert.deepEqual(event.interval.active_spans_ms,[[0,6000]]);
  assert.deepEqual(event.progress.covered_chunk_ids,[0,1]); assert.equal(event.seq,1);
  reading.tick({ now:time+7000,mono:7000,active:true,ratios:[1,1] });
  assert.equal(reading.covered.size,2); assert.deepEqual(event.interval.active_spans_ms,[[0,6000]],'persisted events stay immutable');
});
test('focus, sleep, idle and clock discontinuities never inflate active time', () => {
  const reading = session(); reading.event('session.opened');
  for (let i=1;i<=65;i++) reading.tick({now:time+i*1000,mono:i*1000,active:true,ratios:[1,0]});
  assert.equal(reading.activeMs,60000);
  reading.interact(65000);
  reading.tick({now:time+66000,mono:66000,active:false,ratios:[1,1]}); assert.equal(reading.activeMs,60000);
  reading.tick({now:time+71000,mono:71000,active:true,ratios:[1,1]}); assert.equal(reading.activeMs,60000);
  reading.tick({now:time+72000,mono:72000,active:true,ratios:[1,1]}); assert.equal(reading.activeMs,61000);
  reading.tick({now:time+74000,mono:73000,active:true,ratios:[1,1]}); assert.equal(reading.activeMs,62000);
  reading.tick({now:time+80000,mono:74000,active:true,ratios:[1,1]}); assert.equal(reading.clockChanged,true); assert.equal(reading.activeMs,62000);
});
test('state boundaries and time-only never invent reading progress', () => {
  assert.equal(inferState(9999,300,240,'jawiki'),null);
  assert.equal(inferState(10000,300,240,'jawiki'),'viewed');
  assert.equal(inferState(30000,300,200,'jawiki'),'partial');
  assert.equal(inferState(30000,300,240,'jawiki'),'completed');
  assert.equal(inferState(239999,3000,2400,'jawiki'),'partial');
  assert.equal(inferState(240000,3000,2400,'jawiki'),'completed');
  assert.equal(inferState(1000000,null,0,'jawiki','time_only'),'viewed');
});
test('native session ID and fallback reason follow shared event contract without content', () => {
  const id=uuid(), reading=session({sessionId:id,document:{fingerprint:null,extractor_version:'prose-v1',observed_revision_id:null,text_chars:null,chunk_chars:[],measurement_reason:'body_empty'}});
  const opened=reading.event('session.opened'); assert.equal(opened.session_id,id); assert.equal(opened.progress.reason_code,'body_empty');
  assert.equal('measurement_reason' in opened.document,false); assert.equal('text' in opened.document,false);
});
