export const QUEUE_LIMIT = 8 * 1024 * 1024; // Leave space under chrome.storage.local's 10 MiB quota.
export const QUEUE_AGE_MS = 7 * 86400000;
export class Outbox {
  constructor(storage, now = Date.now) { this.storage = storage; this.now = now; this.tail = Promise.resolve(); }
  serial(operation) { const result = this.tail.then(operation); this.tail = result.catch(() => {}); return result; }
  read() { return this.storage.get('outbox').then(state => state.outbox || { rows: [], quarantine: [], lossCount: 0 }); }
  enqueue(owner, event) {
    return this.serial(async () => {
      const state = await this.read();
      if (state.rows.some(row => row.event.event_id === event.event_id)) return;
      const row = { owner: { user_id: owner.user_id, device_id: owner.device_id }, created_at: this.now(), event: structuredClone(event) };
      if (event.device_id !== owner.device_id) throw new Error('device_mismatch');
      if (state.rows.some(item => this.now() - item.created_at > QUEUE_AGE_MS)) throw new Error('queue_expired');
      const bytes = new TextEncoder().encode(JSON.stringify({ ...state, rows: [...state.rows, row] })).length;
      if (bytes > QUEUE_LIMIT) throw new Error('queue_full');
      state.rows.push(row); await this.storage.set({ outbox: state });
    });
  }
  async batch(owner, maxEvents = 100, maxBytes = 240 * 1024) {
    const state = await this.read(), result = []; let bytes = 40;
    for (const row of state.rows) {
      if (row.owner.user_id !== owner.user_id || row.owner.device_id !== owner.device_id) continue;
      const size = new TextEncoder().encode(JSON.stringify(row.event)).length + 1;
      if (result.length >= maxEvents || bytes + size > maxBytes) break;
      result.push(row.event); bytes += size;
    }
    return result;
  }
  applyAck(owner, response, sentIds) {
    return this.serial(async () => {
      const state = await this.read(), byId = new Map();
      for (const result of response.results || []) {
        if (sentIds.has(result.event_id)) byId.set(result.event_id, result);
      }
      state.rows = state.rows.filter(row => {
        if (row.owner.user_id !== owner.user_id || row.owner.device_id !== owner.device_id) return true;
        const result = byId.get(row.event.event_id);
        if (!result) return true;
        if (['accepted', 'duplicate'].includes(result.status)) return false;
        if (['rejected', 'quarantined'].includes(result.status) && !result.retryable) {
          // Keep a bounded diagnostic record, without another copy of the reading payload.
          state.quarantine.push({ event_id: row.event.event_id, code: result.code || result.status, at: this.now() });
          state.quarantine = state.quarantine.slice(-100); return false;
        }
        return true;
      });
      await this.storage.set({ outbox: state });
    });
  }
  applyControl(owner, control) {
    return this.serial(async () => {
      const state = await this.read(); let removed = 0;
      state.rows = state.rows.filter(row => {
        if (row.owner.user_id !== owner.user_id || row.owner.device_id !== owner.device_id) return true;
        const event = row.event;
        const deleted = (control.deletion_markers || []).some(marker => marker.article_id === event.article_id &&
          Date.parse(event.session_started_at) <= Date.parse(marker.deleted_before));
        const expired = this.now() - row.created_at > QUEUE_AGE_MS;
        if (event.recording_epoch !== control.recording_epoch || deleted || expired) { removed++; return false; }
        return true;
      });
      state.lossCount += removed; await this.storage.set({ outbox: state }); return removed;
    });
  }
  discard(owner) {
    return this.serial(async () => {
      const state = await this.read(), before = state.rows.length;
      state.rows = state.rows.filter(row => row.owner.user_id !== owner.user_id || row.owner.device_id !== owner.device_id);
      state.lossCount += before - state.rows.length; await this.storage.set({ outbox: state });
    });
  }
}
export function trustedContent(sender, extensionId, parseLocation) {
  return sender.id === extensionId && sender.frameId === 0 && Number.isInteger(sender.tab?.id) &&
    !sender.tab?.incognito && !!parseLocation(sender.url);
}
export function trustedPage(sender, extensionId, extensionOrigin) {
  return sender.id === extensionId && (sender.frameId === 0 || sender.frameId === undefined) && !sender.tab?.incognito &&
    [extensionOrigin + 'popup.html'].includes(sender.url);
}
export async function focusedTab(chromeApi) {
  const windows = await chromeApi.windows.getAll({ windowTypes: ['normal'] });
  const focused = windows.find(win => win.focused && !win.incognito);
  if (!focused) return null;
  const [tab] = await chromeApi.tabs.query({ active: true, windowId: focused.id });
  return tab && !tab.incognito ? tab : null;
}
export function validateObservation(event) {
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  const integer = (value, max = 1e12) => Number.isSafeInteger(value) && value >= 0 && value <= max;
  if (!['event_id','device_id','session_id','article_id'].every(key => uuid(event[key])) || !integer(event.seq) || !integer(event.page_id) || event.page_id === 0 || !integer(event.recording_epoch)) return false;
  if (!['session.opened','reading.observed','session.closed'].includes(event.type) || !['jawiki','enwiki'].includes(event.wiki)) return false;
  if (typeof event.client_version !== 'string' || event.client_version.length > 32 || event.measurement_policy_version !== 'reading-v1') return false;
  if (event.reason && !['navigate','reload','pause','logout','document_changed','clock_changed'].includes(event.reason)) return false;
  if (![event.occurred_at,event.session_started_at,event.interval?.start_at,event.interval?.end_at].every(value => typeof value === 'string' && value.length <= 32 && Number.isFinite(Date.parse(value)))) return false;
  const interval = event.interval, document = event.document, progress = event.progress;
  if (Object.keys(interval).some(key => !['start_at','end_at','active_spans_ms'].includes(key))) return false;
  const elapsed = Date.parse(interval.end_at) - Date.parse(interval.start_at);
  if (elapsed < 0 || (elapsed === 0 && event.type === 'reading.observed') || !Array.isArray(interval.active_spans_ms) || interval.active_spans_ms.length > 10000) return false;
  let previous = 0;
  for (const span of interval.active_spans_ms) {
    if (!Array.isArray(span) || span.length !== 2 || !span.every(value => integer(value)) || span[0] < previous || span[1] <= span[0] || span[1] > elapsed) return false;
    previous = span[1];
  }
  if (!document || !progress || document.extractor_version !== 'prose-v1' || (document.observed_revision_id !== null && !integer(document.observed_revision_id))) return false;
  if (!Array.isArray(document.chunk_chars) || document.chunk_chars.length > 5000 || !document.chunk_chars.every(value => integer(value,200) && value > 0) || !Array.isArray(progress.covered_chunk_ids) || !progress.covered_chunk_ids.every(value => integer(value,document.chunk_chars.length - 1))) return false;
  if (!integer(progress.active_ms_total) || typeof progress.max_scroll_ratio !== 'number' || !Number.isFinite(progress.max_scroll_ratio) || progress.max_scroll_ratio < 0 || progress.max_scroll_ratio > 1) return false;
  if (progress.measurement_status === 'ok') {
    if (typeof document.fingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(document.fingerprint) || !integer(document.text_chars,1000000) || document.text_chars === 0 || document.chunk_chars.reduce((sum,value) => sum + value,0) !== document.text_chars || progress.reason_code !== undefined) return false;
  } else if (progress.measurement_status === 'time_only') {
    if (document.fingerprint !== null || document.text_chars !== null || document.chunk_chars.length || progress.covered_chunk_ids.length || !['body_not_found','body_empty','body_limit'].includes(progress.reason_code)) return false;
  } else return false;
  return new TextEncoder().encode(JSON.stringify(event)).length <= 65536;
}
