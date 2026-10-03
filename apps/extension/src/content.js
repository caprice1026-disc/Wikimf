/* global WikiMfTracker */
(() => {
  if (window.top !== window || !WikiMfTracker.articleLocation(location.href)) return;
  let leaseUntil = 0, tracker = null, lastFingerprint = null, starting = null, navigating = false, articleKey = null;
  const send = message => chrome.runtime.sendMessage(message);
  const locationKey = () => JSON.stringify(WikiMfTracker.articleLocation(location.href));
  const host = { active: () => Date.now() < leaseUntil && !!WikiMfTracker.articleLocation(location.href) && locationKey() === articleKey,
    persist: async event => {
      if (!event) return;
      const result = await send({ type: 'observation', event });
      if (!result?.saved) { leaseUntil = 0; if (result?.error === 'article_unresolved') setTimeout(() => { void start(); }, 100); }
    }, restart: () => { void start(); } };
  async function start() {
    if (starting || navigating) return starting;
    starting = (async () => {
      leaseUntil = 0; await tracker?.stop('document_changed'); tracker = null;
      const requestedKey = locationKey();
      const context = await send({ type: 'article.resolve' });
      if (!context?.enabled || navigating || requestedKey !== locationKey()) return;
      articleKey = requestedKey;
      const lease = await send({ type: 'lease' });
      if (!lease?.enabled) return;
      leaseUntil = lease.lease_until;
      tracker = new WikiMfTracker.DOMTracker({ doc: document, host });
      await tracker.start({ article: context.article, deviceId: context.device_id, source: 'chrome_extension', epoch: context.recording_epoch });
      lastFingerprint = tracker.session?.document.fingerprint;
    })().catch(() => { leaseUntil = 0; }).finally(() => { starting = null; });
    return starting;
  }
  async function refresh() {
    if (navigating) return;
    try {
      if (tracker && locationKey() !== articleKey) { await start(); return; }
      const lease = await send({ type: 'lease' });
      leaseUntil = lease?.enabled ? lease.lease_until : 0;
      if (leaseUntil && !tracker) await start();
      if (!leaseUntil && tracker) { await tracker.stop('pause'); tracker = null; }
    } catch { leaseUntil = 0; }
  }
  chrome.runtime.onMessage.addListener(message => {
    if (message.type === 'tracking.stop') { leaseUntil = 0; void tracker?.stop('pause'); tracker = null; setTimeout(() => { void refresh(); }, 100); }
  });
  setInterval(() => { void refresh(); }, 10000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') leaseUntil = 0; else void refresh(); });
  window.addEventListener('blur', () => { leaseUntil = 0; });
  window.addEventListener('focus', () => { void refresh(); });
  window.addEventListener('pagehide', event => { navigating = true; leaseUntil = 0; void tracker?.stop(event.persisted ? 'pause' : 'navigate'); tracker = null; });
  window.addEventListener('pageshow', () => { navigating = false; void start(); });
  // A fragment does not replace a Document. Only an extracted-body change starts a new session.
  let mutationTimer;
  const body = document.querySelector('#mw-content-text');
  if (body) new MutationObserver(() => {
    clearTimeout(mutationTimer);
    mutationTimer = setTimeout(async () => {
      if (!tracker || navigating) return;
      const extracted = WikiMfTracker.extractDocument(document), hash = await WikiMfTracker.fingerprint(extracted);
      if (hash !== lastFingerprint) await start(); else tracker?.refreshDocument(extracted);
    }, 2000);
  }).observe(body, { childList: true, characterData: true, subtree: true });
  void start();
})();
