import test from 'node:test';
import assert from 'node:assert/strict';
import { recordingBlocked, nextSyncCode, recoveredQueueCode } from '../src/sync-state.js';

const terminals = ['schema_mismatch', 'device_revoked', 'owner_mismatch', 'reauth_required'];
test('only a healthy queue clears recoverable queue failures', () => {
  for (const code of ['queue_full', 'queue_expired']) {
    assert.equal(recoveredQueueCode(code, false), code);
    assert.equal(recoveredQueueCode(code, true), 'idle');
  }
  for (const code of [...terminals, 'offline', 'server_paused', 'synced']) assert.equal(recoveredQueueCode(code, true), code);
});
test('ACK, offline and unrelated state changes cannot clear a terminal or queue failure', () => {
  for (const current of terminals) for (const next of ['idle', 'synced', 'offline', 'server_paused', 'queue_full', 'queue_expired'])
    assert.equal(nextSyncCode(current, next), current);
  for (const current of ['queue_full', 'queue_expired']) {
    for (const next of ['idle', 'synced', 'offline', 'server_paused']) assert.equal(nextSyncCode(current, next), current);
    assert.equal(nextSyncCode(current, 'device_revoked'), 'device_revoked');
  }
  assert.equal(nextSyncCode('offline', 'synced'), 'synced');
});
test('lease and popup share the same blocking state classification', () => {
  for (const code of [...terminals, 'queue_full', 'queue_expired']) assert.equal(recordingBlocked(code), true);
  for (const code of ['idle', 'synced', 'offline', undefined]) assert.equal(recordingBlocked(code), false);
});
