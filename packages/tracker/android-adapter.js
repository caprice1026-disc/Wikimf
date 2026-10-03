/* global WikiMfTracker, WikimfObservation */
(() => {
  const context = window.WKMF_CONTEXT;
  if (!context || !WikiMfTracker.articleLocation(location.href) || window.top !== window || !window.WikimfObservation) return;
  if (window.WKMF_NATIVE?.sessionId === context.sessionId) return;
  window.WKMF_NATIVE?.stop('document_changed');
  let active = !!context.active, tracker, stopped = false, mutationTimer, bodyObserver;
  const send = event => { if (event) WikimfObservation.postMessage(JSON.stringify(event)); };
  const changed = () => { if (!stopped) { bridge.stop('document_changed'); send({ kind: 'document_changed' }); } };
  const bridge = { sessionId: context.sessionId,
    setActive(value) {
      active = !!value;
      if (active) tracker?.session?.interact(performance.now());
      tracker?.tick(); if (!active) tracker?.flush();
    },
    stop(reason = 'pause') { stopped = true; active = false; clearTimeout(mutationTimer); bodyObserver?.disconnect(); return tracker?.stop(reason); } };
  window.WKMF_NATIVE = bridge;
  tracker = new WikiMfTracker.DOMTracker({ doc: document, host: { active: () => active && !stopped && !!WikiMfTracker.articleLocation(location.href), persist: send, restart: changed } });
  void tracker.start({ ...context, source: 'android_reader' }).then(() => {
    if (stopped) { tracker.stop('pause'); return; }
    const initial = tracker.session?.document.fingerprint, body = document.querySelector('#mw-content-text');
    if (!body) return;
    bodyObserver = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(async () => {
        if (stopped) return;
        const extracted = WikiMfTracker.extractDocument(document);
        if (await WikiMfTracker.fingerprint(extracted) !== initial) changed(); else tracker.refreshDocument(extracted);
      }, 2000);
    });
    bodyObserver.observe(body, { subtree: true, characterData: true, childList: true });
  });
  window.addEventListener('pagehide', () => bridge.stop('navigate'), { once: true });
})();
