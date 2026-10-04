// One source for the isolated Chrome world and Android's origin-restricted bridge.
export const POLICY = Object.freeze({ extractor: 'prose-v1', measurement: 'reading-v1', chunkChars: 200,
  visibleRatio: 0.5, coverMs: 2000, idleMs: 60000, maxTickMs: 2000, saveMs: 10000 });
export const WIKIS = Object.freeze({ 'ja.wikipedia.org': 'jawiki', 'en.wikipedia.org': 'enwiki' });
export function articleLocation(value) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.port || url.username || url.password || !WIKIS[url.hostname]) return null;
  if (['oldid', 'diff', 'veaction', 'search', 'redirect', 'curtimestamp'].some(key => url.searchParams.has(key))) return null;
  if ([...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)) return null;
  if (url.pathname === '/w/index.php' && url.searchParams.has('curid')) {
    const id = url.searchParams.get('curid');
    if (url.searchParams.has('title') || !/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id)) || Number(id) > 2147483647) return null;
    if (url.searchParams.has('action') && url.searchParams.get('action') !== 'view') return null;
    return { wiki: WIKIS[url.hostname], page_id: Number(id) };
  }
  if (url.searchParams.has('curid')) return null;
  if (url.pathname.startsWith('/wiki/') && url.searchParams.has('title')) return null;
  if (url.searchParams.has('action') && url.searchParams.get('action') !== 'view') return null;
  let title;
  try { title = url.pathname.startsWith('/wiki/') ? decodeURIComponent(url.pathname.slice(6)) :
    url.pathname === '/w/index.php' ? url.searchParams.get('title') : null; } catch { return null; }
  if (!title) return null;
  // Namespace and disambiguation checks remain the server resolver's responsibility.
  return { wiki: WIKIS[url.hostname], title: title.replaceAll('_', ' ') };
}
export function codepointCount(text) { return Array.from(text.normalize('NFC').replace(/\s/gu, '')).length; }
export function chunkSizes(text, size = POLICY.chunkChars) {
  const count = codepointCount(text);
  return Array.from({ length: Math.ceil(count / size) }, (_, i) => Math.min(size, count - i * size));
}
const EXCLUDED = '.infobox,.navbox,.vertical-navbox,.sidebar,.toc,.mw-editsection,.reference,.references,.reflist,.gallery,.hatnote,.metadata,.ambox,.tmbox,.ombox,.noprint,.mw-empty-elt,.mw-visually-hidden,.sr-only,script,style,noscript';
export function excludedElement(element) {
  if (!element || element.closest(EXCLUDED)) return true;
  const hidden = element.closest('[aria-hidden="true"]');
  // Collapsed prose is still a denominator. Hidden decorative text is not.
  return !!hidden && !hidden.closest('.mw-collapsible-content,.collapsible-block,[data-mw-section-id]');
}
const END_SECTIONS = /^(references|notes|citations|bibliography|sources|external links|further reading|脚注|注釈|出典|参考文献|外部リンク|関連項目)$/i;
export function extractDocument(doc) {
  const root = doc.querySelector('#mw-content-text .mw-parser-output') || doc.querySelector('.mw-parser-output');
  if (!root) return { status: 'time_only', reason: 'body_not_found', text: '', chunks: [] };
  const chunks = [], paragraphs = [], seen = new Set();
  let excludedRank = 0;
  for (const block of root.querySelectorAll('h2,h3,h4,h5,h6,p,li')) {
    if (/^H[2-6]$/.test(block.tagName)) {
      const rank = Number(block.tagName[1]);
      if (excludedRank && rank <= excludedRank) excludedRank = 0;
      const label = block.textContent.replace(/\[.*?\]/g, '').trim();
      if (END_SECTIONS.test(label)) excludedRank = rank;
      continue;
    }
    if (excludedRank || excludedElement(block)) continue;
    const spans = []; let raw = '';
    const walker = doc.createTreeWalker(block, 4);
    let node;
    while ((node = walker.nextNode())) {
      if (seen.has(node) || excludedElement(node.parentElement)) continue;
      seen.add(node);
      spans.push({ node, start: raw.length, end: raw.length + node.data.length }); raw += node.data;
    }
    if (!codepointCount(raw)) continue;
    paragraphs.push(raw.normalize('NFC').replace(/\s/gu, ''));
    const tokens = [];
    for (const segment of new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(raw)) {
      for (const char of segment.segment.normalize('NFC')) {
        if (!/\s/u.test(char)) tokens.push({ start: segment.index, end: segment.index + segment.segment.length });
      }
    }
    for (let i = 0; i < tokens.length; i += POLICY.chunkChars) {
      const group = tokens.slice(i, i + POLICY.chunkChars);
      const from = group[0].start, to = group.at(-1).end;
      const start = spans.find(item => from >= item.start && from < item.end);
      const end = spans.find(item => to > item.start && to <= item.end);
      if (!start || !end) continue;
      const range = doc.createRange();
      range.setStart(start.node, from - start.start); range.setEnd(end.node, to - end.start);
      chunks.push({ id: chunks.length, chars: group.length, range, block });
    }
  }
  const text = paragraphs.join('\n');
  if (!chunks.length) return { status: 'time_only', reason: 'body_empty', text: '', chunks: [] };
  if (chunks.length > 5000 || chunks.reduce((sum, chunk) => sum + chunk.chars, 0) > 1000000)
    return { status: 'time_only', reason: 'body_limit', text: '', chunks: [] };
  return { status: 'ok', text, chunks };
}
export async function fingerprint(extracted) {
  if (extracted.status !== 'ok') return null;
  const bytes = new TextEncoder().encode(POLICY.extractor + '\n' + extracted.text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function visibleRatio(rects, width, height) {
  let area = 0, visible = 0;
  for (const rect of rects) {
    if (rect.width <= 0 || rect.height <= 0) continue;
    area += rect.width * rect.height;
    visible += Math.max(0, Math.min(rect.right, width) - Math.max(rect.left, 0)) *
      Math.max(0, Math.min(rect.bottom, height) - Math.max(rect.top, 0));
  }
  return area ? Math.min(1, visible / area) : 0;
}
export function viewportChunks(chunks, height) {
  if (chunks.length <= 16) return chunks;
  // Prose ranges are in document order. Inspect the viewport neighbourhood even
  // when a single very long paragraph is an IntersectionObserver candidate.
  const rects = new Map();
  const rect = index => { if (!rects.has(index)) rects.set(index, chunks[index].range.getBoundingClientRect()); return rects.get(index); };
  const lower = predicate => { let left=0,right=chunks.length; while(left<right) { const middle=(left+right)>>>1; if(predicate(rect(middle))) right=middle; else left=middle+1; } return left; };
  const start=lower(value=>value.bottom>=0),end=lower(value=>value.top>height);
  return chunks.slice(Math.max(0,start-1),Math.min(chunks.length,end+1));
}
export function inferState(activeMs, textChars, coveredChars, wiki, status = 'ok') {
  const rate = wiki === 'enwiki' ? 1000 : 600;
  if (status === 'ok' && textChars > 0) {
    if (coveredChars * 5 >= textChars * 4 && activeMs >= Math.max(30000, 48000 * textChars / rate)) return 'completed';
    if (activeMs >= 30000 && coveredChars >= Math.min(200, textChars)) return 'partial';
  }
  return activeMs >= 10000 ? 'viewed' : null;
}
export class ReadingSession {
  constructor({ article, document, deviceId, source, epoch, sessionId, clientVersion = '0.1.0', now = Date.now(), mono = 0, uuid = () => crypto.randomUUID() }) {
    this.article = article; this.document = document; this.deviceId = deviceId; this.source = source; this.epoch = epoch;
    this.clientVersion = clientVersion; this.uuid = uuid; this.id = sessionId || uuid(); this.startedAt = now;
    this.seq = 0; this.activeMs = 0; this.covered = new Set(); this.dwell = new Map(); this.spans = [];
    this.intervalStart = now; this.lastWall = now; this.lastMono = mono; this.lastInteraction = mono;
    this.maxScroll = 0; this.closed = false; this.clockChanged = false;
    this.lastRatios = [];
  }
  interact(mono) { this.lastInteraction = mono; }
  tick({ now, mono, active, ratios = [], scrollRatio = 0 }) {
    if (this.closed) return;
    const delta = mono - this.lastMono, wallDelta = now - this.lastWall;
    if (delta < 0 || Math.abs(wallDelta - delta) > 2000) this.clockChanged = true;
    const recent = this.lastMono - this.lastInteraction < POLICY.idleMs;
    const accepted = active && recent && this.lastWall >= this.intervalStart && delta > 0 && delta <= POLICY.maxTickMs && !this.clockChanged ?
      Math.floor(Math.min(delta, Math.max(0, wallDelta), Math.max(0, this.lastInteraction + POLICY.idleMs - this.lastMono))) : 0;
    if (accepted) {
      const start = Math.max(0, this.lastWall - this.intervalStart), end = start + accepted;
      const prior = this.spans.at(-1);
      if (prior && prior[1] === start) prior[1] = end; else this.spans.push([start, end]);
      this.activeMs += accepted;
      for (let i = 0; i < ratios.length; i++) {
        // Credit only a span bracketed by visible samples, so a last-moment jump
        // cannot turn the preceding invisible second into covered text.
        if (ratios[i] >= POLICY.visibleRatio && this.lastRatios[i] >= POLICY.visibleRatio && !this.covered.has(i)) {
          const dwell = (this.dwell.get(i) || 0) + accepted; this.dwell.set(i, dwell);
          if (dwell >= POLICY.coverMs) this.covered.add(i);
        }
      }
    }
    this.maxScroll = Math.max(this.maxScroll, Math.max(0, Math.min(1, scrollRatio)));
    this.lastRatios = ratios;
    this.lastWall = now; this.lastMono = mono;
  }
  event(type, now = this.lastWall, reason) {
    if (this.closed) return null;
    if (type !== 'session.opened' && (now < this.intervalStart || (type === 'reading.observed' && now === this.intervalStart))) return null;
    const event = { event_id: this.uuid(), type, device_id: this.deviceId, session_id: this.id,
      session_started_at: new Date(this.startedAt).toISOString(), seq: this.seq++, source: this.source,
      article_id: this.article.article_id, wiki: this.article.wiki, page_id: this.article.page_id,
      recording_epoch: this.epoch, occurred_at: new Date(now).toISOString(),
      interval: { start_at: new Date(this.intervalStart).toISOString(), end_at: new Date(now).toISOString(),
        active_spans_ms: this.spans.map(span => span.slice()) }, document: { ...this.document },
      progress: { active_ms_total: this.activeMs, covered_chunk_ids: [...this.covered].sort((a,b) => a-b),
        measurement_status: this.document.fingerprint ? 'ok' : 'time_only', max_scroll_ratio: this.maxScroll },
      client_version: this.clientVersion, measurement_policy_version: POLICY.measurement };
    if (!this.document.fingerprint) event.progress.reason_code = this.document.measurement_reason || 'body_not_found';
    delete event.document.measurement_reason;
    if (type === 'session.closed') { event.reason = reason || 'navigate'; this.closed = true; }
    this.intervalStart = now; this.spans = [];
    return event;
  }
}
export class DOMTracker {
  constructor({ doc = document, host }) { this.doc = doc; this.host = host; this.session = null; this.enabled = false; this.candidates = new Set(); }
  refreshDocument(extracted) {
    this.extracted = extracted; this.byBlock = new Map();
    this.observer?.disconnect(); this.candidates.clear();
    for (const chunk of extracted.chunks) {
      if (!this.byBlock.has(chunk.block)) this.byBlock.set(chunk.block, []);
      this.byBlock.get(chunk.block).push(chunk); this.observer?.observe(chunk.block);
    }
  }
  async start(context) {
    this.stop('document_changed');
    const generation = this.generation;
    const extracted = extractDocument(this.doc), hash = await fingerprint(extracted);
    if (generation !== this.generation) return;
    this.refreshDocument(extracted);
    const info = { fingerprint: hash, extractor_version: POLICY.extractor, observed_revision_id: null,
      text_chars: hash ? extracted.chunks.reduce((sum, chunk) => sum + chunk.chars, 0) : null,
      chunk_chars: extracted.chunks.map(chunk => chunk.chars) };
    if (!hash) info.measurement_reason = extracted.reason;
    this.session = new ReadingSession({ ...context, document: info, now: Date.now(), mono: performance.now() });
    this.wasActive = this.doc.visibilityState === 'visible' && this.doc.hasFocus() && this.host.active();
    this.enabled = true; await this.host.persist(this.session.event('session.opened'));
    this.lastSave = performance.now();
    this.interaction = event => { if (event.isTrusted) this.session?.interact(performance.now()); };
    for (const name of ['scroll', 'wheel', 'pointerdown', 'touchstart', 'keydown']) this.doc.addEventListener(name, this.interaction, { passive: true });
    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) this.candidates.add(entry.target); else this.candidates.delete(entry.target);
      }
    }, { rootMargin: '200px' });
    for (const chunk of extracted.chunks) this.observer.observe(chunk.block);
    this.timer = setInterval(() => this.tick(), 1000);
    this.visibility = () => { this.tick(); if (this.doc.visibilityState !== 'visible' || !this.doc.hasFocus()) this.flush(); else this.session?.interact(performance.now()); };
    this.doc.addEventListener('visibilitychange', this.visibility);
    this.doc.defaultView.addEventListener('blur', this.visibility);
    this.doc.defaultView.addEventListener('focus', this.visibility);
  }
  tick() {
    if (!this.session) return;
    const win = this.doc.defaultView, mono = performance.now(), now = Date.now();
    this.flushBeforeIntervalLimit(now);
    const active = this.enabled && this.doc.visibilityState === 'visible' && this.doc.hasFocus() && this.host.active();
    if (active && !this.wasActive) {
      this.session.lastWall = now; this.session.lastMono = mono; this.session.interact(mono);
    }
    this.wasActive = active;
    const ratios = Array(this.extracted.chunks.length).fill(0);
    if (active) for (const block of this.candidates) {
      for (const chunk of viewportChunks(this.byBlock.get(block) || [], win.innerHeight))
        ratios[chunk.id] = visibleRatio(chunk.range.getClientRects(), win.innerWidth, win.innerHeight);
    }
    this.session.tick({ now, mono, active, ratios,
      scrollRatio: win.scrollY / Math.max(1, this.doc.documentElement.scrollHeight - win.innerHeight) });
    if (this.session.clockChanged) { this.stop('clock_changed'); this.host.restart?.(); return; }
    if (mono - this.lastSave >= POLICY.saveMs) { this.lastSave = mono; this.flush(); }
  }
  flushBeforeIntervalLimit(now) {
    if (!this.session || now - this.session.intervalStart <= 60000) return;
    // Persist the sampled prefix before moving past an unobserved suspension.
    const last = this.session.lastWall, event = this.session.event('reading.observed', last);
    if (event) this.host.persist(event);
    if (now - last > POLICY.maxTickMs) this.session.intervalStart = now;
  }
  flush() { const event = this.session?.event('reading.observed'); if (event) return this.host.persist(event); }
  stop(reason = 'pause') {
    this.generation = (this.generation || 0) + 1;
    clearInterval(this.timer); this.observer?.disconnect(); this.candidates.clear();
    if (this.interaction) for (const name of ['scroll', 'wheel', 'pointerdown', 'touchstart', 'keydown']) this.doc.removeEventListener(name, this.interaction);
    if (this.visibility) {
      this.doc.removeEventListener('visibilitychange', this.visibility);
      this.doc.defaultView.removeEventListener('blur', this.visibility); this.doc.defaultView.removeEventListener('focus', this.visibility);
    }
    const now = Date.now(); this.flushBeforeIntervalLimit(now);
    const event = this.session?.event('session.closed', now, reason);
    this.enabled = false; this.session = null;
    if (event) return this.host.persist(event);
  }
}
