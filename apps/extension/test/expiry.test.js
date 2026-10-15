import test from 'node:test';
import assert from 'node:assert/strict';
import { Outbox, QUEUE_AGE_MS, queueExpirySummary } from '../src/outbox.js';

const DAY=86400000, now=Date.parse('2026-10-13T12:00:00Z');
const owner={user_id:'expiry-user',device_id:'expiry-device'};
const empty={near_count:0,expired_count:0,unknown_count:0,remaining_ms:null,clock_anomaly:false};
const row=(age,other=owner)=>({owner:other,created_at:now-age,event:{event_id:crypto.randomUUID(),device_id:other.device_id,
  occurred_at:new Date(now-age).toISOString(),session_started_at:new Date(now-age).toISOString()}});

test('expiry display ignores empty, unlinked and foreign user/device snapshots',()=>{
  const rows=[row(QUEUE_AGE_MS-1,{...owner,user_id:'other'}),row(QUEUE_AGE_MS+1,{...owner,device_id:'other'})];
  assert.deepEqual(queueExpirySummary([],owner,now),empty);
  assert.deepEqual(queueExpirySummary(rows,owner,now),empty);
  assert.deepEqual(queueExpirySummary([row(QUEUE_AGE_MS-1)],null,now),empty);
});
test('expiry warning includes 24h and seven-day boundaries without changing expiry policy',()=>{
  for(const [remaining,near,expired] of [[DAY+1,0,0],[DAY,1,0],[1,1,0],[0,1,0],[-1,0,1]]){
    assert.deepEqual(queueExpirySummary([row(QUEUE_AGE_MS-remaining)],owner,now),
      {...empty,near_count:near,expired_count:expired,remaining_ms:near?remaining:null},String(remaining));
  }
});
test('old session time can limit delivery before a later local enqueue time',()=>{
  const recent=row(1000);recent.event.session_started_at=new Date(now-QUEUE_AGE_MS+3600000).toISOString();
  const older=row(1000);older.event.occurred_at=new Date(now-QUEUE_AGE_MS+1800000).toISOString();
  assert.deepEqual(queueExpirySummary([recent,older,row(QUEUE_AGE_MS+1)],owner,now),
    {...empty,near_count:2,expired_count:1,remaining_ms:1800000});
});
test('missing, malformed and future row timestamps never invent a countdown',()=>{
  const invalid=[undefined,null,NaN,-1,'123',now+1];
  for(const created_at of invalid)assert.deepEqual(queueExpirySummary([{...row(1000),created_at}],owner,now),{...empty,unknown_count:1});
  for(const at of [undefined,null,0,NaN,'invalid',new Date(now+1).toISOString()]){
    for(const field of ['occurred_at','session_started_at']){
      const item=row(1000);item.event[field]=at;
      assert.deepEqual(queueExpirySummary([item],owner,now),{...empty,unknown_count:1});
    }
  }
  for(const current of [NaN,Infinity,-1])assert.deepEqual(queueExpirySummary([row(1000)],owner,current),{...empty,unknown_count:1});
});
test('a detected wall-clock jump suppresses both remaining time and expiry claims',()=>{
  assert.deepEqual(queueExpirySummary([row(QUEUE_AGE_MS-1),row(QUEUE_AGE_MS+1)],owner,now,false),
    {...empty,unknown_count:2,clock_anomaly:true});
});
test('known approaching rows coexist with unknown rows without modifying payload or credentials',()=>{
  const rows=[row(QUEUE_AGE_MS-1000),{...row(1000),created_at:null}],before=structuredClone({rows,owner});
  Object.freeze(rows[0].event);Object.freeze(rows[0]);Object.freeze(rows[1]);Object.freeze(rows);Object.freeze(owner);
  assert.deepEqual(queueExpirySummary(rows,owner,now),{...empty,near_count:1,unknown_count:1,remaining_ms:1000});
  assert.deepEqual({rows,owner},before);
});
test('enqueue, explicit per-item ACK and restart refresh a read-only expiry snapshot',async()=>{
  const data={};let clock=now-QUEUE_AGE_MS+1000,writes=0;
  const storage={get:async key=>({[key]:structuredClone(data[key])}),set:async value=>{writes++;Object.assign(data,structuredClone(value));}};
  const queue=new Outbox(storage,()=>clock),first=row(QUEUE_AGE_MS-1000).event;
  await queue.enqueue(owner,first);clock=now;await queue.enqueue(owner,row(1000).event);
  const restarted=new Outbox(storage,()=>clock),before=structuredClone(data),beforeWrites=writes;
  assert.equal(queueExpirySummary((await restarted.read()).rows,owner,clock).near_count,1);
  assert.deepEqual(data,before);assert.equal(writes,beforeWrites);
  await restarted.applyAck(owner,{results:[{event_id:first.event_id,status:'accepted'}]},new Set([first.event_id]));
  assert.deepEqual(queueExpirySummary((await restarted.read()).rows,owner,clock),empty);
});
