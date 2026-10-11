/* global WikiMfTracker */
(() => {
  if (window.top !== window || !WikiMfTracker.articleLocation(location.href)) return;
  let leaseUntil = 0, tracker = null, lastFingerprint = null, starting = null, navigating = false, articleKey = null, generation = 0;
  const send = message => chrome.runtime.sendMessage(message);
  const locationKey = () => JSON.stringify(WikiMfTracker.articleLocation(location.href));
  const visible = () => !navigating && document.visibilityState === 'visible' && document.hasFocus();
  const host = { active: () => Date.now() < leaseUntil && visible() && !!WikiMfTracker.articleLocation(location.href) && locationKey() === articleKey,
    persist: async event => {
      if (!event) return;
      const result = await send({ type: 'observation', event });
      if (!result?.saved) { leaseUntil = 0; if (result?.error === 'article_unresolved') setTimeout(() => { void start(); }, 100); }
    }, restart: () => { void start(); } };
  function cancel(reason = 'pause', stop = true) {
    const requestId = generation++;
    leaseUntil = 0; starting = null;
    // Cancel the matching document attempt only; a late cancel cannot revoke a newer start.
    void send({ type: 'article.cancel', request_id: requestId }).catch(() => {});
    if (!stop) return;
    const previous = tracker; tracker = null;
    return previous?.stop(reason);
  }
  async function start() {
    if (starting || !visible()) return starting;
    const stopped = cancel('document_changed'), requestedGeneration = generation, requestedKey = locationKey();
    const current = () => generation === requestedGeneration && visible() && requestedKey === locationKey();
    const attempt = (async () => {
      await stopped;
      if (!current()) return;
      const context = await send({ type: 'article.resolve', request_id: requestedGeneration });
      if (!context?.enabled || !current()) return;
      const lease = await send({ type: 'lease' });
      if (!lease?.enabled || !current()) return;
      articleKey = requestedKey; leaseUntil = lease.lease_until;
      const activeTracker = new WikiMfTracker.DOMTracker({ doc: document, host }); tracker = activeTracker;
      await activeTracker.start({ article: context.article, deviceId: context.device_id, source: 'chrome_extension', epoch: context.recording_epoch });
      if (!current()) { await activeTracker.stop('pause'); return; }
      lastFingerprint = activeTracker.session?.document.fingerprint;
    })().catch(() => { if (current()) leaseUntil = 0; }).finally(() => { if (starting === attempt) starting = null; });
    starting = attempt; return attempt;
  }
  async function refresh() {
    if (!visible() || starting) return;
    const requestedGeneration = generation, requestedKey = locationKey();
    try {
      if (tracker && requestedKey !== articleKey) { await start(); return; }
      const lease = await send({ type: 'lease' });
      if (generation !== requestedGeneration || !visible() || requestedKey !== locationKey()) return;
      leaseUntil = lease?.enabled ? lease.lease_until : 0;
      if (leaseUntil && !tracker) await start();
      if (!leaseUntil && tracker) await cancel();
    } catch { if (generation === requestedGeneration) leaseUntil = 0; }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'tracking.stop') { void cancel(); setTimeout(() => { void refresh(); }, 100); }
  });
  setInterval(() => { void refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (!visible()) void cancel('pause', !!starting); else void refresh(); });
  window.addEventListener('blur', () => { void cancel('pause', !!starting); });
  window.addEventListener('focus', () => { void refresh(); });
  window.addEventListener('pagehide', event => { navigating = true; void cancel(event.persisted ? 'pause' : 'navigate'); });
  window.addEventListener('pageshow', () => { navigating = false; void start(); });
  // A fragment does not replace a Document. Only an extracted-body change starts a new session.
  let mutationTimer;
  const body = document.querySelector('#mw-content-text');
  if (body) new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(async () => {
      if (!tracker || navigating) return;
      const requestedGeneration = generation, activeTracker = tracker;
      const extracted = WikiMfTracker.extractDocument(document), hash = await WikiMfTracker.fingerprint(extracted);
      if (generation !== requestedGeneration || tracker !== activeTracker || navigating) return;
      if (hash !== lastFingerprint) { await cancel('document_changed'); await start(); }
      else activeTracker.refreshDocument(extracted);
    }, 2000);
  }).observe(body, { childList: true, characterData: true, subtree: true });
  void start();
})();
