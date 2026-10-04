const terminal = new Set(['reauth_required', 'device_revoked', 'owner_mismatch', 'schema_mismatch']);
const queueProblems = new Set(['queue_full', 'queue_expired']);

export const isQueueProblem = code => queueProblems.has(code);
export const recordingBlocked = code => terminal.has(code) || isQueueProblem(code);

// A successful request is not evidence that a terminal failure or a full queue recovered.
export function nextSyncCode(current, next) {
  if (terminal.has(current) && !terminal.has(next)) return current;
  if (isQueueProblem(current) && !terminal.has(next) && !isQueueProblem(next)) return current;
  return next;
}
export function recoveredQueueCode(current, healthy) {
  return isQueueProblem(current) && healthy ? 'idle' : current;
}
