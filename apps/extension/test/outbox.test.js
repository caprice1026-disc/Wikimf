import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, trustedContent, trustedPage, focusedTab, validateObservation, QUEUE_AGE_MS } from '../src/outbox.js';
import { ReadingSession } from '../../../packages/tracker/tracker.js';
const user={user_id:crypto.randomUUID(),device_id:crypto.randomUUID()};
function memory(){const data={};return {get:async key=>structuredClone({[key]:data[key]}),set:async value=>Object.assign(data,structuredClone(value))};}
function event(){const now=Date.now();return new ReadingSession({article:{article_id:crypto.randomUUID(),wiki:'jawiki',page_id:1},deviceId:user.device_id,source:'chrome_extension',epoch:1,now,mono:0,document:{fingerprint:'a'.repeat(64),extractor_version:'prose-v1',observed_revision_id:null,text_chars:200,chunk_chars:[200]}}).event('session.opened');}
test('durable queue is serialized and stays bound to original account/device across restarts',async()=>{
  const storage=memory(),queue=new Outbox(storage),events=[event(),event(),event()];
  await Promise.all(events.map(item=>queue.enqueue(user,item)));
  const restarted=new Outbox(storage); assert.equal((await restarted.batch(user)).length,3);
  assert.deepEqual(await restarted.batch({...user,user_id:crypto.randomUUID()}),[]);
  assert.deepEqual(await restarted.batch({...user,device_id:crypto.randomUUID()}),[]);
  await queue.enqueue(user,events[0]); assert.equal((await queue.batch(user)).length,3);
});
test('per-item ACK deletes only accepted/duplicate, quarantines terminal rejection and retains missing/retryable',async()=>{
  const queue=new Outbox(memory()),events=Array.from({length:5},event); for(const item of events) await queue.enqueue(user,item);
  await queue.applyAck(user,{results:[{event_id:events[0].event_id,status:'accepted'},{event_id:events[1].event_id,status:'duplicate'},{event_id:events[2].event_id,status:'rejected',code:'event_conflict'},{event_id:events[3].event_id,status:'rejected',retryable:true}]},new Set(events.map(item=>item.event_id)));
  assert.deepEqual((await queue.batch(user)).map(item=>item.event_id),events.slice(3).map(item=>item.event_id));
  assert.equal((await queue.read()).quarantine[0].code,'event_conflict');
  await queue.applyAck({...user,user_id:crypto.randomUUID()},{results:[{event_id:events[4].event_id,status:'accepted'}]},new Set([events[4].event_id])); assert.equal((await queue.batch(user)).length,2);
});
test('control epoch and article deletion prevent old offline sessions from returning; other owner untouched',async()=>{
  const queue=new Outbox(memory()),old=event(),deleted=event(),fresh=event(),other={user_id:crypto.randomUUID(),device_id:crypto.randomUUID()};
  fresh.recording_epoch=2; deleted.recording_epoch=2;
  await queue.enqueue(user,old);await queue.enqueue(user,deleted);await queue.enqueue(user,fresh);
  const foreign=event();foreign.device_id=other.device_id;await queue.enqueue(other,foreign);
  assert.equal(await queue.applyControl(user,{recording_epoch:2,deletion_markers:[{article_id:deleted.article_id,deleted_before:new Date(Date.now()+1000).toISOString()}]}),2);
  assert.deepEqual((await queue.batch(user)).map(item=>item.event_id),[fresh.event_id]);assert.equal((await queue.batch(other)).length,1);
});
test('queue expiry refuses new observations without silently replacing retained records',async()=>{
  let now=0;const queue=new Outbox(memory(),()=>now);await queue.enqueue(user,event());now=QUEUE_AGE_MS+1;
  await assert.rejects(queue.enqueue(user,event()),/queue_expired/);assert.equal((await queue.read()).rows.length,1);
});
test('trusted content excludes foreign extensions, subframes, incognito, lookalike URLs; popup is exact',()=>{
  const parse=url=>url==='https://ja.wikipedia.org/wiki/A'?{}:null;
  const sender={id:'test',frameId:0,tab:{id:1},url:'https://ja.wikipedia.org/wiki/A'};
  assert.equal(trustedContent(sender,'test',parse),true);
  for(const change of [{id:'other'},{frameId:1},{tab:{id:1,incognito:true}},{url:'https://evil.test/'}]) assert.equal(trustedContent({...sender,...change},'test',parse),false);
  assert.equal(trustedPage({id:'test',url:'chrome-extension://test/popup.html'},'test','chrome-extension://test/'),true);
  assert.equal(trustedPage({id:'test',url:'chrome-extension://test/popup.html?next=evil'},'test','chrome-extension://test/'),false);
});
test('lease has a single focused non-incognito window and its active tab',async()=>{
  const api={windows:{getAll:async()=>[{id:1,focused:false},{id:2,focused:true}]},tabs:{query:async query=>{assert.equal(query.windowId,2);return [{id:3}];}}};
  assert.equal((await focusedTab(api)).id,3);api.windows.getAll=async()=>[{id:1,focused:false}];assert.equal(await focusedTab(api),null);
});
test('observation type boundary rejects embedded text, malformed chunks/interval and oversized payload',()=>{
  const valid=event();assert.equal(validateObservation(valid),true);
  assert.equal(validateObservation({...valid,document:{...valid.document,chunk_chars:['token']}}),false);
  assert.equal(validateObservation({...valid,interval:{...valid.interval,text:'private body'}}),false);
  assert.equal(validateObservation({...valid,progress:{...valid.progress,max_scroll_ratio:NaN}}),false);
  assert.equal(validateObservation({...valid,article_id:'secret'}),false);
});
