import { Outbox, trustedContent, trustedPage, focusedTab, validateObservation } from './outbox.js';
import { API_ORIGIN, DASHBOARD_ORIGIN, CLIENT_VERSION } from './config.js';
import { articleLocation } from './tracker-module.js';
import { isQueueProblem, recordingBlocked, nextSyncCode, recoveredQueueCode } from './sync-state.js';
const api = chrome, storage = api.storage.local, outbox = new Outbox(storage);
let syncing = null, retryAt = 0, failures = 0;
let pairingPoll = null;
let statusTail = Promise.resolve();
const bindings = new Map();
const ready = Promise.all([storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),api.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })]);
const owner = async () => (await storage.get('credentials')).credentials;
const settings = async () => ({ recording: false, ...((await storage.get('settings')).settings || {}) });
async function request(path, { method = 'GET', body, auth, signal } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth?.token) headers.Authorization = 'Bearer ' + auth.token;
  return fetch(API_ORIGIN + '/api/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store', credentials: 'omit', signal: signal || AbortSignal.timeout(15000) });
}
async function notifyStop() {
  const tabs = await api.tabs.query({ url: ['https://ja.wikipedia.org/*', 'https://en.wikipedia.org/*'] });
  await Promise.allSettled(tabs.map(tab => api.tabs.sendMessage(tab.id, { type: 'tracking.stop' }, { frameId: 0 })));
}
function updateSyncStatus(transition) {
  const result = statusTail.then(async () => {
    const current = (await storage.get('syncStatus')).syncStatus?.code || 'idle';
    const code = await transition(current);
    if (code !== current) await storage.set({ syncStatus: { code, at: Date.now() } });
    return code !== current;
  });
  statusTail = result.catch(() => {}); return result;
}
const setProblem = code => updateSyncStatus(current => nextSyncCode(current, code));
const recoverQueueProblem = () => updateSyncStatus(async current =>
  isQueueProblem(current) ? recoveredQueueCode(current, await outbox.canAcceptObservation()) : current);
async function control(auth) {
  const response = await request('/me/recording-control', { auth });
  if (!response.ok) throw new Error(response.status === 401 ? 'reauth_required' : response.status === 403 ? 'device_revoked' : 'control_unavailable');
  const result = await response.json();
  if (result.user_id !== auth.user_id || result.device_id !== auth.device_id) throw new Error('owner_mismatch');
  await outbox.applyControl(auth, result);
  const recovered = await recoverQueueProblem();
  const previous = (await storage.get('control')).control;
  await storage.set({ control: result });
  if (recovered || (previous && (previous.recording_epoch !== result.recording_epoch ||
      JSON.stringify(previous.deletion_markers) !== JSON.stringify(result.deletion_markers)))) await notifyStop();
  if (!result.collection_enabled) await notifyStop();
  return result;
}
function scheduleRetry(response) {
  const retryAfter = response?.headers.get('Retry-After');
  const seconds = Number(retryAfter);
  const explicit = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
  failures++; retryAt = Date.now() + Math.max(explicit || 0, Math.min(3600000, 1000 * 2 ** Math.min(failures, 11)) * (0.75 + Math.random() / 2));
  return storage.set({ retryAt, retryState: { failures } });
}
async function sendBatch(auth, events) {
  const response = await request('/reading-events/batch', { method: 'POST', auth, body: { schema_version: 1, events } });
  if (response.status === 413) {
    if (events.length > 1) {
      const midpoint = Math.ceil(events.length / 2);
      await sendBatch(auth, events.slice(0, midpoint)); await sendBatch(auth, events.slice(midpoint)); return;
    }
    await outbox.applyAck(auth, { results: [{ event_id: events[0].event_id, status: 'rejected', code: 'event_too_large' }] }, new Set(events.map(event => event.event_id)));
    if (await recoverQueueProblem()) await notifyStop(); return;
  }
  if (response.status === 401 || response.status === 403) {
    await setProblem(response.status === 401 ? 'reauth_required' : 'device_revoked'); await notifyStop(); return;
  }
  if (response.status === 422) {
    await outbox.applyAck(auth, { results: events.map(event => ({ event_id: event.event_id, status: 'rejected', code: 'schema_mismatch' })) }, new Set(events.map(event => event.event_id)));
    await setProblem('schema_mismatch'); return;
  }
  if (!response.ok) { await scheduleRetry(response); throw new Error('retry_pending'); }
  const result = await response.json();
  await outbox.applyAck(auth, result, new Set(events.map(event => event.event_id)));
  failures = 0; retryAt = 0; await storage.set({ retryAt: 0, retryState: { failures: 0 } });
  if (await recoverQueueProblem()) await notifyStop();
  await setProblem('synced');
  if (result.recording_epoch !== auth.recording_epoch) await control(auth);
}
async function sync(force = false) {
  if (syncing) return syncing;
  syncing = (async () => {
    await ready;
    const auth = await owner(), options = await settings();
    retryAt = Math.max(retryAt, (await storage.get('retryAt')).retryAt || 0);
    failures = Math.max(failures, (await storage.get('retryState')).retryState?.failures || 0);
    if (!auth || !options.sendQueued || (!force && Date.now() < retryAt)) return;
    try {
      const remote = await control(auth);
      if (!remote.collection_enabled) { await setProblem('server_paused'); return; }
      const events = await outbox.batch(auth);
      if (events.length) await sendBatch(auth, events);
    } catch (error) {
      const code = ['reauth_required', 'device_revoked', 'owner_mismatch'].includes(error.message) ? error.message : 'offline';
      await setProblem(code); if (code !== 'offline') await notifyStop(); else await scheduleRetry();
    }
  })().finally(() => { syncing = null; });
  return syncing;
}
async function pairStart() {
  const existing = await owner();
  if (existing) throw new Error('already_linked');
  const response = await request('/device-links', { method: 'POST', body: { source: 'chrome_extension', display_name: 'Chrome' } });
  if (!response.ok) throw new Error('pairing_unavailable');
  const result = await response.json();
  const verification = new URL(result.verification_url);
  if (verification.origin !== DASHBOARD_ORIGIN || verification.username || verification.password || verification.search || verification.hash ||
      verification.pathname !== '/link-device/' + result.link_id) throw new Error('invalid_verification_origin');
  await storage.set({ pairing: result });
  await api.tabs.create({ url: result.verification_url });
  return { user_code: result.user_code, expires_at: result.expires_at, poll_interval_seconds: result.poll_interval_seconds };
}
function pairPoll() {
  if (pairingPoll) return pairingPoll;
  pairingPoll = pollPairing().finally(() => { pairingPoll = null; }); return pairingPoll;
}
async function pollPairing() {
  const pairing = (await storage.get('pairing')).pairing;
  if (!pairing) return { pending: false };
  if (Date.parse(pairing.expires_at) < Date.now()) { await storage.remove('pairing'); return { expired: true }; }
  if (Date.now() < (pairing.next_poll_at || 0)) return { pending: true, user_code: pairing.user_code };
  await storage.set({ pairing: { ...pairing, next_poll_at: Date.now() + Math.max(5000,Number(pairing.poll_interval_seconds || 5)*1000) + 500 } });
  const response = await request('/device-links/' + encodeURIComponent(pairing.link_id) + '/exchange', { method: 'POST', body: { device_secret: pairing.device_secret } });
  if (response.status === 429) return { pending: true, user_code: pairing.user_code };
  if (response.status === 409) {
    const result = await response.json();
    if (result.error?.code === 'authorization_pending') return { pending: true, user_code: pairing.user_code };
  }
  if (!response.ok) {
    if (response.status >= 400 && response.status < 500 && response.status !== 429) await storage.remove('pairing');
    throw new Error('pairing_failed');
  }
  const auth = await response.json();
  await storage.set({ credentials: auth, settings: { recording: false, sendQueued: true }, control: null });
  // Completing an explicit new device link is the user's terminal-error recovery action.
  await updateSyncStatus(() => 'idle');
  await storage.remove('pairing'); return { pending: false, linked: true };
}
async function status() {
  const auth = await owner(), state = await outbox.read(), options = await settings(), stored = await storage.get(['syncStatus', 'pairing', 'control']);
  const code = stored.syncStatus?.code || 'idle';
  let currentArticle = null;
  const tab = await focusedTab(api);
  const binding = tab ? (await api.storage.session.get('binding:' + tab.id))['binding:' + tab.id] : null;
  if (auth && binding?.user_id === auth.user_id && binding.device_id === auth.device_id) {
    try {
      const response = await request('/me/articles/' + binding.article_id, { auth, signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const record = await response.json();
        currentArticle = { title: record.article.title, wiki: binding.wiki, state: record.effective_state,
          evidence: record.evidence, active_ms: record.active_ms, coverage: record.coverage };
      }
    } catch { /* The persisted queue status is available even when article metadata is offline. */ }
  }
  return { linked: !!auth, display_name: auth?.display_name, recording: options.recording,
    recording_enabled: !!auth && options.recording && !recordingBlocked(code) && stored.control?.collection_enabled !== false,
    queued: state.rows.filter(row => row.owner.user_id === auth?.user_id && row.owner.device_id === auth?.device_id).length,
    rejected: state.quarantine.length, discarded: state.lossCount, sync: code,
    current_article: currentArticle,
    pairing: stored.pairing ? { user_code: stored.pairing.user_code, expires_at: stored.pairing.expires_at } : null, dashboard_url: DASHBOARD_ORIGIN };
}
async function contentMessage(message, sender) {
  const auth = await owner(), options = await settings();
  if (!auth || (!options.recording && !(message.type === 'observation' && message.event?.type === 'session.closed'))) return { enabled: false };
  if (message.type === 'lease') {
    const tab = await focusedTab(api);
    const remote = (await storage.get('control')).control;
    const denied = recordingBlocked((await storage.get('syncStatus')).syncStatus?.code);
    return { enabled: !denied && remote?.collection_enabled !== false && tab?.id === sender.tab.id,
      lease_until: Date.now() + 15000 };
  }
  if (message.type === 'article.resolve') {
    const location = articleLocation(sender.url);
    const canonical = new URL(sender.url); canonical.hash = ''; canonical.search = '';
    if (canonical.pathname === '/w/index.php') {
      if (location.page_id) canonical.searchParams.set('curid', String(location.page_id)); else canonical.searchParams.set('title', location.title);
    }
    const response = await request('/articles/resolve', { method: 'POST', auth, body: { url: canonical.href } });
    if (!response.ok) return { enabled: false, code: 'article_unresolved' };
    const article = await response.json(), remote = await control(auth);
    if (article.namespace !== 0 || !article.trackable || !remote.collection_enabled) return { enabled: false };
    const binding = { document_id: sender.documentId, user_id: auth.user_id, device_id: auth.device_id, article_id: article.article_id, wiki: article.wiki, page_id: article.page_id };
    bindings.set(sender.tab.id, binding);
    await api.storage.session.set({ ['binding:' + sender.tab.id]: binding });
    return { enabled: true, article, device_id: auth.device_id, recording_epoch: remote.recording_epoch, client_version: CLIENT_VERSION };
  }
  if (message.type === 'observation') {
    const event = message.event, location = articleLocation(sender.url);
    if (!event || event.source !== 'chrome_extension' || event.device_id !== auth.device_id || event.wiki !== location.wiki) throw new Error('invalid_observation');
    const binding = bindings.get(sender.tab.id) || (await api.storage.session.get('binding:' + sender.tab.id))['binding:' + sender.tab.id];
    if (!binding || binding.user_id !== auth.user_id || binding.device_id !== auth.device_id || binding.document_id !== sender.documentId || binding.article_id !== event.article_id || binding.wiki !== event.wiki || binding.page_id !== event.page_id) throw new Error('article_unresolved');
    // Only the contracted observation fields are accepted; page text/URLs/keys never enter storage.
    const keys = ['event_id','type','device_id','session_id','session_started_at','seq','source','article_id','wiki','page_id','recording_epoch','occurred_at','interval','document','progress','client_version','measurement_policy_version','reason'];
    if (Object.keys(event).some(key => !keys.includes(key))) throw new Error('unknown_observation_field');
    if (Object.keys(event.document || {}).some(key => !['fingerprint','extractor_version','observed_revision_id','text_chars','chunk_chars'].includes(key)) ||
        Object.keys(event.progress || {}).some(key => !['active_ms_total','covered_chunk_ids','measurement_status','reason_code','max_scroll_ratio'].includes(key))) throw new Error('unknown_observation_field');
    if (!validateObservation(event)) throw new Error('invalid_observation');
    try { await outbox.enqueue(auth, event); } catch (error) { await setProblem(error.message); await notifyStop(); throw error; }
    void sync(); return { saved: true };
  }
  throw new Error('unknown_message');
}
async function pageMessage(message) {
  const auth = await owner();
  switch (message.type) {
    case 'status': return status();
    case 'pair.start': return pairStart();
    case 'pair.poll': return pairPoll();
    case 'recording': {
      if (!auth) throw new Error('link_required');
      if (message.enabled) { await control(auth); const remote = (await storage.get('control')).control; if (!remote.collection_enabled) throw new Error('server_paused'); }
      await storage.set({ settings: { recording: !!message.enabled, sendQueued: message.enabled ? true : !!message.sendQueued } });
      await notifyStop(); if (message.sendQueued || message.enabled) void sync(true); return status();
    }
    case 'sync': await sync(true); return status();
    case 'discard':
      if (auth) { await outbox.discard(auth); if (await recoverQueueProblem()) await notifyStop(); }
      return status();
    case 'logout': {
      if (!auth) return status();
      const pending = (await outbox.batch(auth)).length;
      if (pending && !message.discard) { await sync(true); if ((await outbox.batch(auth)).length) throw new Error('unsent_records'); }
      if (message.discard) await outbox.discard(auth);
      await storage.remove(['credentials', 'control', 'pairing']);
      bindings.clear(); await api.storage.session.clear();
      await storage.set({ settings: { recording: false, sendQueued: false } }); await notifyStop(); return status();
    }
    default: throw new Error('unknown_message');
  }
}
api.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const content = trustedContent(sender, api.runtime.id, articleLocation), page = trustedPage(sender, api.runtime.id, api.runtime.getURL(''));
  if (!content && !page) { sendResponse({ error: 'untrusted_sender' }); return false; }
  ready.then(() => content ? contentMessage(message, sender) : pageMessage(message))
    .then(sendResponse).catch(error => sendResponse({ error: error.message })); return true;
});
api.tabs.onActivated.addListener(() => { void notifyStop(); });
api.tabs.onRemoved.addListener(id => { bindings.delete(id); void api.storage.session.remove('binding:' + id); });
api.windows.onFocusChanged.addListener(() => { void notifyStop(); });
api.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'wikimf-sync') { void sync(); void pairPoll().catch(() => {}); } });
api.runtime.onInstalled.addListener(() => { void api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); });
api.runtime.onStartup.addListener(() => { void api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); void sync(); });
void ready.then(async () => { if (!(await api.alarms.get('wikimf-sync'))) await api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); await sync(); });
