import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, articleLocation, codepointCount, chunkSizes, excludedElement, visibleRatio, viewportChunks, inferState, ReadingSession, DOMTracker } from '../tracker.js';
import { validateObservation } from '../../../apps/extension/src/outbox.js';
const time = Date.UTC(2026,9,4,0);
const uuid = () => crypto.randomUUID();
function session(overrides = {}) {
  return new ReadingSession({ article: { article_id: uuid(), wiki: 'jawiki', page_id: 1 }, deviceId: uuid(),
    source: 'chrome_extension', epoch: 1, now: time, mono: 0,
    document: { fingerprint: 'a'.repeat(64), extractor_version: POLICY.extractor, observed_revision_id: null, text_chars: 400, chunk_chars: [200,200] }, ...overrides });
}
function suspendedTracker(run) {
  const clock = { mono: 0, active: true }, events = [], originalNow = Date.now;
  const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  Date.now = () => time + (clock.wall ?? clock.mono);
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock.mono } });
  try {
    const doc = { visibilityState: 'visible', hasFocus: () => true, removeEventListener() {},
      defaultView: { innerWidth: 100, innerHeight: 100, scrollY: 0, removeEventListener() {} },
      documentElement: { scrollHeight: 1000 } };
    const tracker = new DOMTracker({ doc, host: { active: () => clock.active, persist: event => events.push(event) } });
    tracker.session = session({ source: 'android_reader' }); tracker.extracted = { chunks: [] };
    tracker.enabled = true; tracker.wasActive = true; tracker.lastSave = 0;
    events.push(tracker.session.event('session.opened'));
    run({ tracker, clock, events });
  } finally {
    Date.now = originalNow;
    Object.defineProperty(globalThis, 'performance', originalPerformance);
  }
}
function assertIntervals(events) {
  let total = 0, priorEnd = time;
  for (const [seq, event] of events.entries()) {
    const start = Date.parse(event.interval.start_at), end = Date.parse(event.interval.end_at);
    assert.equal(event.seq, seq); assert.equal(event.session_id, events[0].session_id);
    assert.ok(start >= priorEnd); assert.ok(end - start >= 0 && end - start <= 60000, `seq ${seq} interval is ${end - start} ms`);
    if (event.type === 'reading.observed') assert.ok(end > start);
    let spanEnd = 0, active = 0;
    for (const [from, to] of event.interval.active_spans_ms) {
      assert.ok(from >= spanEnd && to > from && to <= end - start);
      active += to - from; spanEnd = to;
    }
    assert.equal(event.progress.active_ms_total - total, active, 'adjacent seq preserves cumulative active accounting');
    total = event.progress.active_ms_total; priorEnd = end;
  }
}
function recordThreeSeconds(tracker) {
  for (let i = 1; i <= 3; i++) tracker.session.tick({ now: time + i * 1000, mono: i * 1000, active: true, ratios: [1, 0] });
}
function resumeOneSecond(tracker, clock) {
  clock.active = true; clock.mono = 102000; tracker.tick();
  clock.mono = 103000; tracker.tick(); tracker.flush();
}
test('1–2000ms wall reversals preserve valid pending time across flushes in both hosts', () => {
  for (const source of ['chrome_extension', 'android_reader']) for (const reversal of [1, 500, 1500, 2000]) for (const flushed of [false, true]) {
    const reading = session({ source }), events = [reading.event('session.opened')];
    reading.tick({ now: time + 3000, mono: 3000, active: false });
    reading.tick({ now: time + 4000, mono: 4000, active: true });
    if (flushed) events.push(reading.event('reading.observed'));
    reading.tick({ now: time + 4000 - reversal, mono: 5000, active: true });
    assert.equal(reading.clockChanged, true);
    events.push(reading.event('session.closed', time + 4000 - reversal, 'clock_changed'));
    assertIntervals(events); assert.ok(events.every(validateObservation));
    assert.equal(events.at(-1).progress.active_ms_total, 1000);
    assert.equal(events.at(-1).occurred_at, new Date(time + 4000).toISOString());
  }
});
test('DOM host closes at its last valid sample and requests a fresh session after reversal', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    let restarted = 0; tracker.host.restart = () => restarted++;
    clock.mono = 1000; tracker.tick(); clock.mono = 2000; clock.wall = 999; tracker.tick();
    assert.equal(tracker.session, null); assert.equal(restarted, 1);
    assertIntervals(events); assert.ok(events.every(validateObservation));
    assert.equal(events.at(-1).reason, 'clock_changed'); assert.equal(events.at(-1).progress.active_ms_total, 1000);
    const fresh = session({ now: time + 999, mono: 2000 });
    fresh.tick({ now: time + 1999, mono: 3000, active: true });
    assert.ok(validateObservation(fresh.event('reading.observed')));
  });
});
test('a close before the next tick and a large clock jump both retain valid sampled spans', () => {
  const reading = session(), events = [reading.event('session.opened')];
  reading.tick({ now: time + 1000, mono: 1000, active: true });
  events.push(reading.event('session.closed', time + 999, 'pause'));
  assertIntervals(events); assert.ok(events.every(validateObservation));
  suspendedTracker(({ tracker, clock, events }) => {
    recordThreeSeconds(tracker); clock.mono = 4000; clock.wall = 120000; tracker.tick();
    assertIntervals(events); assert.equal(events.at(-1).type, 'session.closed');
    assert.equal(events.at(-1).progress.active_ms_total, 3000); assert.ok(events.every(validateObservation));
  });
});
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
  assert.equal(inferState(29999,3000,2400,'jawiki'),'viewed');
  assert.equal(inferState(30000,3000,2400,'jawiki'),'completed');
  assert.equal(inferState(1000000,null,0,'jawiki','time_only'),'viewed');
});
test('native session ID and fallback reason follow shared event contract without content', () => {
  const id=uuid(), reading=session({sessionId:id,document:{fingerprint:null,extractor_version:'prose-v1',observed_revision_id:null,text_chars:null,chunk_chars:[],measurement_reason:'body_empty'}});
  const opened=reading.event('session.opened'); assert.equal(opened.session_id,id); assert.equal(opened.progress.reason_code,'body_empty');
  assert.equal('measurement_reason' in opened.document,false); assert.equal('text' in opened.document,false);
});

test('a saved prefix followed by a 98-second empty pause never creates an oversized event or credits the pause', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    recordThreeSeconds(tracker); tracker.flush(); const saved = JSON.stringify(events);
    clock.mono = 101000; clock.active = false; tracker.wasActive = false; tracker.tick();
    assertIntervals(events); assert.equal(events.length, 2); assert.equal(tracker.session.activeMs, 3000);
    assert.equal(tracker.session.intervalStart, time + 101000);
    resumeOneSecond(tracker, clock); assertIntervals(events);
    assert.equal(events.at(-1).progress.active_ms_total, 4000);
    assert.deepEqual(events.at(-1).interval.active_spans_ms, [[1000, 2000]]);
    assert.equal(JSON.stringify(events.slice(0, 2)), saved);
  });
});

test('an unsaved active prefix survives a 98-second pause and keeps coverage, cumulative time, and seq', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    recordThreeSeconds(tracker);
    clock.mono = 101000; clock.active = false; tracker.wasActive = false; tracker.tick();
    assertIntervals(events); assert.equal(events.length, 2);
    assert.deepEqual(events[1].interval.active_spans_ms, [[0, 3000]]);
    assert.deepEqual(events[1].progress.covered_chunk_ids, [0]);
    assert.equal(events[1].progress.active_ms_total, 3000);
    const saved = JSON.stringify(events[1]);
    resumeOneSecond(tracker, clock); assertIntervals(events);
    assert.equal(events.at(-1).progress.active_ms_total, 4000);
    assert.deepEqual(events.at(-1).progress.covered_chunk_ids, [0]);
    assert.equal(JSON.stringify(events[1]), saved);
  });
});

test('stopping after a 98-second suspension preserves pending spans before a zero-length close', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    recordThreeSeconds(tracker); clock.mono = 101000; tracker.stop('pause');
    assertIntervals(events); assert.equal(events.length, 3);
    assert.deepEqual(events[1].interval.active_spans_ms, [[0, 3000]]);
    assert.equal(events[1].progress.active_ms_total, 3000);
    const closed = events[2]; assert.equal(closed.type, 'session.closed'); assert.equal(closed.reason, 'pause');
    assert.equal(closed.interval.start_at, closed.interval.end_at);
    assert.deepEqual(closed.interval.active_spans_ms, []); assert.equal(closed.progress.active_ms_total, 3000);
    assert.deepEqual(closed.progress.covered_chunk_ids, [0]); assert.equal(tracker.session, null);
  });
});

test('a full 60-second pending interval is saved before the next continuous active sample', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    for (let i = 1; i <= 60; i++) tracker.session.tick({ now: time + i * 1000, mono: i * 1000, active: true, ratios: [1, 0] });
    tracker.session.interact(60000); clock.mono = 61000; tracker.tick();
    assertIntervals(events); assert.equal(events.length, 3);
    assert.deepEqual(events[1].interval.active_spans_ms, [[0, 60000]]);
    assert.deepEqual(events[2].interval.active_spans_ms, [[0, 1000]]);
    assert.equal(events[2].progress.active_ms_total, 61000);
  });
});

test('a skipped wall-clock gap cannot credit a sample before the new interval begins', () => {
  suspendedTracker(({ tracker, clock, events }) => {
    for (let i = 1; i <= 59; i++) tracker.session.tick({ now: time + i * 1000, mono: i * 1000, active: true, ratios: [1, 0] });
    tracker.session.tick({ now: time + 59900, mono: 59900, active: true, ratios: [1, 0] });
    tracker.session.interact(59900); tracker.lastSave = 59900;
    clock.wall = 62500; clock.mono = 60900; tracker.tick();
    assert.equal(tracker.session.clockChanged, false, 'the existing 2-second clock tolerance still applies');
    assert.equal(tracker.session.activeMs, 59900, 'the skipped gap contributes no active time');
    assert.deepEqual(tracker.session.spans, []);
    clock.wall = 63500; clock.mono = 61900; tracker.tick(); tracker.flush();
    assertIntervals(events); assert.equal(events.length, 3);
    assert.deepEqual(events[1].interval.active_spans_ms, [[0, 59900]]);
    assert.deepEqual(events[2].interval.active_spans_ms, [[0, 1000]]);
    assert.equal(events[2].progress.active_ms_total, 60900);
  });
});

test('reading-v2 covers at 1.8s with 200ms samples, cumulative visits, and 50% visibility', () => {
  const reading = session();
  reading.tick({now:time,mono:0,active:true,ratios:[.5,.499]});
  for(let t=200;t<=1600;t+=200) reading.tick({now:time+t,mono:t,active:true,ratios:[.5,.499]});
  assert.deepEqual([...reading.covered],[]);
  reading.tick({now:time+1800,mono:1800,active:true,ratios:[.5,.499]});assert.deepEqual([...reading.covered],[0]);
  reading.tick({now:time+2000,mono:2000,active:true,ratios:[0,1]});
  for(let t=2200;t<=3000;t+=200) reading.tick({now:time+t,mono:t,active:true,ratios:[0,1]});
  reading.tick({now:time+3200,mono:3200,active:false,ratios:[]});
  reading.tick({now:time+3400,mono:3400,active:true,ratios:[0,1]});
  for(let t=3600;t<=4400;t+=200) reading.tick({now:time+t,mono:t,active:true,ratios:[0,1]});
  assert.deepEqual([...reading.covered],[0,1]);assert.equal(reading.event('reading.observed').measurement_policy_version,'reading-v2');
});
test('same-document stop samples its active tail; document replacement does not', () => {
  for (const reason of ['pause','document_changed']) suspendedTracker(({tracker,clock,events}) => {
    clock.mono=1000;tracker.tick();clock.mono=1700;tracker.stop(reason);
    assertIntervals(events);assert.ok(events.every(validateObservation));
    assert.equal(events.at(-1).progress.active_ms_total,reason==='pause'?1700:1000);
  });
});
test('short and long articles use 80% and 30s completion without a speed gate', () => {
  for (const wiki of ['jawiki','enwiki']) for(const n of [100,10000]) {
    assert.equal(inferState(30000,n,n*.8,wiki),'completed');
    assert.notEqual(inferState(29999,n,n*.8,wiki),'completed');
    assert.notEqual(inferState(30000,n,n*.8-1,wiki),'completed');
    assert.notEqual(inferState(30000,n,0,wiki),'completed');
  }
});

test('observer-ready ticks scan only visible blocks while collapsed prose remains in the document', () => {
  suspendedTracker(({tracker,clock}) => {
    let calls=0;
    const hidden={};const visible={};
    const chunks=Array.from({length:121},(_,id)=>({id,block:id===120?visible:hidden,range:{
      getBoundingClientRect:()=>({top:0,bottom:id===120?100:0}),
      getClientRects:()=>{calls++;return id===120?[{left:0,top:0,right:100,bottom:100,width:100,height:100}]:[]}
    }}));
    tracker.extracted={chunks};tracker.byBlock=new Map([[hidden,chunks.slice(0,120)],[visible,[chunks[120]]]]);
    tracker.candidates=new Set([visible]);tracker.observerReady=true;
    tracker.session.document.text_chars=24200;tracker.session.document.chunk_chars=Array(121).fill(200);
    clock.mono=200;tracker.tick();assert.equal(calls,1);
    assert.equal(tracker.session.document.text_chars,24200);
  });
});
