import { Outbox, queueExpirySummary, trustedContent, trustedPage, focusedTab, validateObservation } from './outbox.js';
import { API_ORIGIN, DASHBOARD_ORIGIN, CLIENT_VERSION } from './config.js';
import { articleLocation } from './tracker-module.js';
import { isQueueProblem, recordingBlocked, nextSyncCode, recoveredQueueCode } from './sync-state.js';
const api = chrome, storage = api.storage.local, outbox = new Outbox(storage);
const expiryClock = { wall: Date.now(), monotonic: performance.now() };
let syncing = null, retryAt = 0, failures = 0;
let pairingPoll = null;
let draining = false;
let statusTail = Promise.resolve();
const bindings = new Map(), resolutions = new Map();
let controlSequence = 0, appliedControlSequence = 0, localGeneration = 0, viewGeneration = 0, unlinking = false;
const sameOwner = (left, right) => !!left && !!right && left.user_id === right.user_id &&
  left.device_id === right.device_id && left.token === right.token;
const invalidateLocal = () => { controlSequence++; return ++localGeneration; };
const controlCurrent = grant => !!grant && grant.sequence === controlSequence && grant.generation === localGeneration;
const currentOwner = async (auth, generation) => sameOwner(await owner(), auth) && generation === localGeneration;
function cancelResolution(id, documentId, requestId) {
  const current = resolutions.get(id);
  if (!documentId || (current?.documentId === documentId && current.requestId === requestId)) resolutions.delete(id);
}
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
function updateSyncStatus(transition, isCurrent = () => true) {
  const result = statusTail.then(async () => {
    const current = (await storage.get('syncStatus')).syncStatus?.code || 'idle';
    const code = await transition(current);
    if (!isCurrent()) return false;
    if (code !== current) await storage.set({ syncStatus: { code, at: Date.now() } });
    return code !== current;
  });
  statusTail = result.catch(() => {}); return result;
}
const setProblem = (code, isCurrent) => updateSyncStatus(current => nextSyncCode(current, code), isCurrent);
const recoverQueueProblem = isCurrent => updateSyncStatus(async current =>
  isQueueProblem(current) ? recoveredQueueCode(current, await outbox.canAcceptObservation()) : current, isCurrent);
async function control(auth) {
  const grant = { sequence: ++controlSequence, generation: localGeneration };
  const isCurrent = async () => {
    const matches = sameOwner(await owner(), auth);
    return matches && controlCurrent(grant);
  };
  try {
    const response = await request('/me/recording-control', { auth });
    if (!await isCurrent()) throw new Error('control_changed');
    if (!response.ok) throw new Error(response.status === 401 ? 'reauth_required' : response.status === 403 ? 'device_revoked' : 'control_unavailable');
    let result = await response.json();
    if (!await isCurrent()) throw new Error('control_changed');
    if (result.user_id !== auth.user_id || result.device_id !== auth.device_id) throw new Error('owner_mismatch');
    const previous = (await storage.get('control')).control;
    if (previous?.user_id === auth.user_id && previous.device_id === auth.device_id &&
        result.recording_epoch < previous.recording_epoch) throw new Error('control_changed');
    // A stale reply must not prune even one row. The guard runs inside the outbox's
    // serial transaction, and the queue and control snapshot commit in one write.
    if (await outbox.applyControl(auth, result, { isCurrent, isLatest: () => controlCurrent(grant), persistControl: true }) === null || !controlCurrent(grant))
      throw new Error('control_changed');
    result = (await storage.get('control')).control;
    if (!controlCurrent(grant)) throw new Error('control_changed');
    appliedControlSequence = grant.sequence;
    const recovered = await recoverQueueProblem(() => controlCurrent(grant));
    if (result.collection_enabled) await updateSyncStatus(current => current === 'server_paused' ? 'idle' : current, () => controlCurrent(grant));
    if (!await isCurrent()) throw new Error('control_changed');
    if (recovered || (previous && (previous.recording_epoch !== result.recording_epoch ||
        JSON.stringify(previous.deletion_markers) !== JSON.stringify(result.deletion_markers)))) await notifyStop();
    if (!result.collection_enabled) await notifyStop();
    return { ...grant, remote: result };
  } catch (error) {
    if (!await isCurrent()) throw new Error('control_changed');
    error.controlGrant = grant;
    throw error;
  }
}
function scheduleRetry(response, isCurrent = () => true) {
  if (!isCurrent()) return;
  const retryAfter = response?.headers.get('Retry-After');
  const seconds = Number(retryAfter);
  const explicit = retryAfter ? (Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) : 0;
  failures++; retryAt = Date.now() + Math.max(explicit || 0, Math.min(3600000, 1000 * 2 ** Math.min(failures, 11)) * (0.75 + Math.random() / 2));
  return storage.set({ retryAt, retryState: { failures } });
}
async function sendBatch(auth, events, canSend) {
  if (!await canSend() || !canSend.current()) return false;
  const response = await request('/reading-events/batch', { method: 'POST', auth, body: { schema_version: 1, events } });
  if (!await canSend() || !canSend.current()) return false;
  if (response.status === 413) {
    if (events.length > 1) {
      const midpoint = Math.ceil(events.length / 2);
      return await sendBatch(auth, events.slice(0, midpoint), canSend) && await sendBatch(auth, events.slice(midpoint), canSend);
    }
    await outbox.applyAck(auth, { results: [{ event_id: events[0].event_id, status: 'rejected', code: 'event_too_large' }] }, new Set(events.map(event => event.event_id)));
    if (await recoverQueueProblem(canSend.current)) await notifyStop(); return true;
  }
  if (response.status === 401 || response.status === 403) {
    await setProblem(response.status === 401 ? 'reauth_required' : 'device_revoked', canSend.current); await notifyStop(); return false;
  }
  if (response.status === 422) {
    await outbox.applyAck(auth, { results: events.map(event => ({ event_id: event.event_id, status: 'rejected', code: 'schema_mismatch' })) }, new Set(events.map(event => event.event_id)));
    await setProblem('schema_mismatch', canSend.current); return false;
  }
  if (!response.ok) { await scheduleRetry(response, canSend.current); throw new Error('retry_pending'); }
  const result = await response.json();
  if (!await canSend() || !canSend.current()) return false;
  await outbox.applyAck(auth, result, new Set(events.map(event => event.event_id)));
  if (!canSend.current()) return false;
  failures = 0; retryAt = 0; await storage.set({ retryAt: 0, retryState: { failures: 0 } });
  if (await recoverQueueProblem(canSend.current)) await notifyStop();
  await setProblem('synced', canSend.current);
  if (result.recording_epoch !== canSend.epoch) await control(auth);
  return true;
}
async function sync(force = false, expectedAuth = null, expectedGeneration = localGeneration) {
  if (syncing) return force ? syncing.then(() => sync(true, expectedAuth, expectedGeneration)) : syncing;
  syncing = (async () => {
    await ready;
    const generation = localGeneration, auth = await owner(), options = await settings();
    retryAt = Math.max(retryAt, (await storage.get('retryAt')).retryAt || 0);
    failures = Math.max(failures, (await storage.get('retryState')).retryState?.failures || 0);
    if (!auth || (expectedAuth && !sameOwner(auth, expectedAuth)) || expectedGeneration !== localGeneration || generation !== localGeneration ||
        (!force && (unlinking || !(options.recording || options.sendQueued) || Date.now() < retryAt))) return false;
    let grant;
    try {
      grant = await control(auth);
      const canSend = async () => {
        const state = await storage.get(['credentials', 'settings']);
        return controlCurrent(grant) && sameOwner(state.credentials, auth) &&
          (force || (!unlinking && (state.settings?.recording || state.settings?.sendQueued)));
      };
      canSend.current = () => controlCurrent(grant);
      canSend.epoch = grant.remote.recording_epoch;
      if (!await canSend() || !canSend.current()) return false;
      if (!grant.remote.collection_enabled) { await setProblem('server_paused', canSend.current); return false; }
      const events = await outbox.batch(auth);
      return !events.length || await sendBatch(auth, events, canSend);
    } catch (error) {
      if (error.message === 'control_changed' || !await currentOwner(auth, generation)) return false;
      const isCurrent = () => controlCurrent(grant || error.controlGrant);
      if (!isCurrent()) return false;
      const code = ['reauth_required', 'device_revoked', 'owner_mismatch'].includes(error.message) ? error.message : 'offline';
      await setProblem(code, isCurrent);
      if (isCurrent()) { if (code !== 'offline') await notifyStop(); else await scheduleRetry(undefined, isCurrent); }
      return false;
    }
  })().finally(() => { syncing = null; });
  return syncing;
}
async function drainQueue(auth,generation) {
  if(draining)throw new Error('unsent_records');
  draining=true;
  try {
    const ids=new Set((await outbox.read()).rows.filter(row=>row.owner.user_id===auth?.user_id&&row.owner.device_id===auth?.device_id).map(row=>row.event.event_id));
    const remaining=async()=> (await outbox.read()).rows.filter(row=>ids.has(row.event.event_id)&&row.owner.user_id===auth?.user_id&&row.owner.device_id===auth?.device_id).length;
    let pending=ids.size;const deadline=Date.now()+120000;
    for(let rounds=pending;pending&&rounds>0;rounds--){
      if(Date.now()>=deadline||!await currentOwner(auth,generation)||!await sync(true,auth,generation))return false;
      const after=await remaining();if(after>=pending)return false;pending=after;
    }
    return pending===0;
  } finally {draining=false;}
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
  await outbox.serial(async () => {
    if ((await storage.get('pairing')).pairing?.link_id !== pairing.link_id || await owner()) throw new Error('pairing_failed');
    invalidateLocal();
    await storage.set({ credentials: auth, settings: { recording: false, sendQueued: true }, control: null });
  });
  // Completing an explicit new device link is the user's terminal-error recovery action.
  await updateSyncStatus(() => 'idle');
  await storage.remove('pairing'); return { pending: false, linked: true };
}
async function status() {
  const generation = localGeneration, sequence = controlSequence, applied = appliedControlSequence;
  const stored = await storage.get(['credentials', 'outbox', 'settings', 'syncStatus', 'pairing', 'control']);
  const auth = stored.credentials, state = stored.outbox || { rows: [], quarantine: [], lossCount: 0 }, options = { recording: false, ...stored.settings };
  const code = stored.syncStatus?.code || 'idle';
  let currentArticle = null;
  const tab = await focusedTab(api);
  const binding = tab ? (await api.storage.session.get('binding:' + tab.id))['binding:' + tab.id] : null;
  if (auth && binding?.user_id === auth.user_id && binding.device_id === auth.device_id) {
    try {
      const response = await request('/me/articles/' + binding.article_id, { auth, signal: AbortSignal.timeout(3000) });
      if (response.ok) {
        const record = await response.json();
        currentArticle = { article_id: binding.article_id, title: record.article.title, wiki: binding.wiki, state: record.effective_state,
          evidence: record.evidence, active_ms: record.active_ms, coverage: record.coverage };
      }
    } catch { /* The persisted queue status is available even when article metadata is offline. */ }
  }
  if (generation !== localGeneration || sequence !== controlSequence || applied !== appliedControlSequence) return status();
  const wall = Date.now(), clockStable = Math.abs(wall - expiryClock.wall - (performance.now() - expiryClock.monotonic)) <= 60000;
  return { linked: !!auth, display_name: auth?.display_name, recording: options.recording, sendQueued: !!options.sendQueued,
    operation_in_progress: unlinking || draining, unlinking,
    recording_enabled: !!auth && !unlinking && options.recording && !recordingBlocked(code) &&
      appliedControlSequence === controlSequence && stored.control?.collection_enabled === true,
    queued: state.rows.filter(row => row.owner.user_id === auth?.user_id && row.owner.device_id === auth?.device_id).length,
    rejected: state.quarantine.length, discarded: state.lossCount, sync: code,
    expiry: queueExpirySummary(state.rows, auth, wall, clockStable),
    current_article: currentArticle,
    pairing: stored.pairing ? { user_code: stored.pairing.user_code, expires_at: stored.pairing.expires_at } : null, dashboard_url: DASHBOARD_ORIGIN };
}
async function contentMessage(message, sender) {
  if (message.type === 'article.cancel') {
    cancelResolution(sender.tab.id, sender.documentId, message.request_id); return { canceled: true };
  }
  const generation = localGeneration, view = viewGeneration, sequence = controlSequence, applied = appliedControlSequence;
  const resolution = message.type === 'article.resolve' ? { documentId: sender.documentId, requestId: message.request_id, locationKey: JSON.stringify(articleLocation(sender.url)) } : null;
  if (resolution) resolutions.set(sender.tab.id, resolution);
  const auth = await owner(), options = await settings();
  if (unlinking || generation !== localGeneration || !auth || (!options.recording && !(message.type === 'observation' && message.event?.type === 'session.closed'))) return { enabled: false };
  if (message.type === 'lease') {
    const tab = await focusedTab(api);
    const remote = (await storage.get('control')).control;
    const denied = recordingBlocked((await storage.get('syncStatus')).syncStatus?.code);
    const binding = bindings.get(sender.tab.id) || (await api.storage.session.get('binding:' + sender.tab.id))['binding:' + sender.tab.id];
    const deleted = remote?.deletion_markers?.some(marker => marker.article_id === binding?.article_id && Date.now() <= Date.parse(marker.deleted_before));
    return { enabled: generation === localGeneration && view === viewGeneration && sequence === controlSequence &&
      applied === appliedControlSequence && applied === sequence &&
      !unlinking && !denied && !deleted && remote?.collection_enabled === true && tab?.id === sender.tab.id,
      lease_until: Date.now() + 15000 };
  }
  if (message.type === 'article.resolve') {
    let grant;
    try { grant = await control(auth); }
    catch (error) { if (error.message === 'control_changed') return { enabled: false }; throw error; }
    const currentResolution = () => controlCurrent(grant) && generation === localGeneration && view === viewGeneration &&
      !unlinking && resolutions.get(sender.tab.id) === resolution;
    const stillEligible = async () => {
      const state = await storage.get(['credentials', 'settings', 'syncStatus']);
      const tab = await focusedTab(api);
      return currentResolution() && sameOwner(state.credentials, auth) && state.settings?.recording &&
        !recordingBlocked(state.syncStatus?.code) && tab?.id === sender.tab.id &&
        (!tab.url || JSON.stringify(articleLocation(tab.url)) === JSON.stringify(articleLocation(sender.url)));
    };
    // No await between the final generation check and URL transmission.
    if (!grant.remote.collection_enabled || !await stillEligible() || !currentResolution()) return { enabled: false };
    const location = articleLocation(sender.url);
    const canonical = new URL(sender.url); canonical.hash = ''; canonical.search = '';
    if (canonical.pathname === '/w/index.php') {
      if (location.page_id) canonical.searchParams.set('curid', String(location.page_id)); else canonical.searchParams.set('title', location.title);
    }
    const response = await request('/articles/resolve', { method: 'POST', auth, body: { url: canonical.href } });
    if (!response.ok) return { enabled: false, code: 'article_unresolved' };
    const article = await response.json();
    if (article.namespace !== 0 || !article.trackable || !await stillEligible() || !currentResolution()) return { enabled: false };
    const binding = { document_id: sender.documentId, location_key: resolution.locationKey, user_id: auth.user_id, device_id: auth.device_id, article_id: article.article_id, wiki: article.wiki, page_id: article.page_id };
    // Serialize against unlink so an old response cannot recreate a cleared binding.
    const bound = await outbox.serial(async () => {
      if (!await stillEligible() || !currentResolution()) return false;
      bindings.set(sender.tab.id, binding);
      await api.storage.session.set({ ['binding:' + sender.tab.id]: binding }); return true;
    });
    if (!bound || !await stillEligible() || !currentResolution()) return { enabled: false };
    if (grant.remote.deletion_markers?.some(marker => marker.article_id === article.article_id && Date.now() <= Date.parse(marker.deleted_before))) return { enabled: false };
    return { enabled: true, article, device_id: auth.device_id, recording_epoch: grant.remote.recording_epoch, client_version: CLIENT_VERSION };
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
    try {
      if (!await outbox.enqueue(auth, event, { isCurrent: () => currentOwner(auth, generation),
        isLatest: () => generation === localGeneration && !unlinking })) return { saved: false };
    } catch (error) { await setProblem(error.message, () => generation === localGeneration); await notifyStop(); throw error; }
    void sync(); return { saved: true };
  }
  throw new Error('unknown_message');
}
async function pageMessage(message) {
  const generation = ['recording', 'logout'].includes(message.type) ? invalidateLocal() : localGeneration;
  const auth = await owner();
  switch (message.type) {
    case 'status': return status();
    case 'pair.start': return pairStart();
    case 'pair.poll': return pairPoll();
    case 'recording': {
      if (!auth) throw new Error('link_required');
      if (unlinking) throw new Error('unsent_records');
      const previousOptions = await settings();
      if (message.enabled && !previousOptions.recording) {
        const grant = await control(auth);
        if (!grant.remote.collection_enabled) throw new Error('server_paused');
      }
      const changed = await outbox.serial(async () => {
        if (!await currentOwner(auth, generation) || generation !== localGeneration) return false;
        await storage.set({ settings: { recording: !!message.enabled, sendQueued: !!message.sendQueued } }); return true;
      });
      if (changed) { await notifyStop(); if (message.sendQueued || message.enabled) void sync(); }
      return status();
    }
    case 'sync': if(message.drain)await drainQueue(auth,generation);else await sync(true, auth, generation); return status();
    case 'discard.preview':
      if(!auth)throw new Error('link_required');
      {const state=await outbox.read();const ids=state.rows.filter(row=>row.owner.user_id===auth.user_id&&row.owner.device_id===auth.device_id).map(row=>row.event.event_id);
      if(!await currentOwner(auth,generation))throw new Error('queue_changed');return {device_id:auth.device_id,event_ids:ids,queued:ids.length};}
    case 'discard':
      if (auth) { if(message.expected_device_id&&message.expected_device_id!==auth.device_id)throw new Error('queue_changed');if(await outbox.discard(auth,message.expected_event_ids,()=>currentOwner(auth,generation))===false)throw new Error('queue_changed');if (await recoverQueueProblem()) await notifyStop(); }
      return status();
    case 'logout': {
      if (!auth) return status();
      if (unlinking) throw new Error('unsent_records');
      unlinking = true;
      try {
        await notifyStop();
        const ownRows = async () => (await outbox.read()).rows.filter(row =>
          row.owner.user_id === auth.user_id && row.owner.device_id === auth.device_id).length;
        let pending = await ownRows();
        // Each round must remove at least one row; the initial count and deadline
        // bound partial ACK servers too. Failure never destroys the remaining rows.
        const deadline = Date.now() + 120000;
        for (let rounds = pending; pending && !message.discard && rounds > 0; rounds--) {
          if (Date.now() >= deadline || !await currentOwner(auth, generation) || !await sync(true, auth, generation)) throw new Error('unsent_records');
          const remaining = await ownRows();
          if (remaining >= pending) throw new Error('unsent_records');
          pending = remaining;
        }
        if (pending && !message.discard) throw new Error('unsent_records');
        if (!await currentOwner(auth, generation) || generation !== localGeneration) throw new Error('unsent_records');
        if (message.discard) { if(message.expected_device_id&&message.expected_device_id!==auth.device_id)throw new Error('queue_changed');if(await outbox.discard(auth,message.expected_event_ids,()=>currentOwner(auth,generation))===false)throw new Error('queue_changed'); }
        await outbox.serial(async () => {
          if (!await currentOwner(auth, generation) || generation !== localGeneration) throw new Error('unsent_records');
          await storage.remove(['credentials', 'control', 'pairing']);
          bindings.clear(); resolutions.clear(); await api.storage.session.clear();
          await storage.set({ settings: { recording: false, sendQueued: false } });
        });
      } finally { unlinking = false; await notifyStop(); }
      return status();
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
api.tabs.onActivated.addListener(() => { viewGeneration++; resolutions.clear(); void notifyStop(); });
api.tabs.onRemoved.addListener(id => { cancelResolution(id); bindings.delete(id); void api.storage.session.remove('binding:' + id); });
api.tabs.onUpdated.addListener(async (id, change) => {
  if (change.status !== 'loading' && !change.url) return;
  if (change.status !== 'loading') {
    const known = resolutions.get(id)?.locationKey || bindings.get(id)?.location_key ||
      (await api.storage.session.get('binding:' + id))['binding:' + id]?.location_key;
    if (known === JSON.stringify(articleLocation(change.url))) return; // Fragments keep the Document.
  }
  cancelResolution(id); bindings.delete(id); await api.storage.session.remove('binding:' + id);
});
api.windows.onFocusChanged.addListener(() => { viewGeneration++; resolutions.clear(); void notifyStop(); });
api.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'wikimf-sync') { void sync(); void pairPoll().catch(() => {}); } });
api.runtime.onInstalled.addListener(() => { void api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); });
api.runtime.onStartup.addListener(() => { void api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); void sync(); });
void ready.then(async () => { if (!(await api.alarms.get('wikimf-sync'))) await api.alarms.create('wikimf-sync', { periodInMinutes: 1 }); await sync(); });
