/*
 * Injected into the user's Amazon tab when they click "Read my Amazon
 * purchases" (and only then: the extension has no standing access to
 * Amazon). Reads as that tab, with the user's own session, builds the export
 * and gives it to the background worker. Nothing is sent anywhere else.
 *
 * Every read carries the id the background gave it, on every report, so a
 * read that was stopped can never speak for the one that replaced it.
 */
(function () {
  'use strict';
  const MTD = globalThis.MTD;
  // Injected again into a tab that already has it: the first copy answers.
  if (MTD.reader) return;

  let current = null; // { readId, cancelled }

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (sender.id !== chrome.runtime.id || sender.tab || !msg) return false;
    if (msg.type === 'read-cancel' && current && current.readId === msg.readId) current.cancelled = true;
    if (msg.type === 'read-ping') respond(!!current && current.readId === msg.readId && !current.cancelled);
    return false;
  });

  function localDay(now) {
    const p = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
  }

  /** A same-site request with the tab's own cookies. Paths only: never another site. */
  async function request({ path, method = 'GET', form, json, headers = {}, referrerPath }) {
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) {
      throw new Error('not a same-site path');
    }
    const init = { method, credentials: 'include', redirect: 'follow', headers: { ...headers } };
    if (form) init.body = new URLSearchParams(form);
    if (json) {
      init.body = JSON.stringify(json);
      init.headers['Content-Type'] = 'application/json';
    }
    if (referrerPath) init.referrer = location.origin + referrerPath;
    const res = await fetch(location.origin + path, init);
    return { status: res.status, url: res.url, text: await res.text() };
  }

  /** Start a read. One that is still stopping is told to stop and left to finish quietly. */
  async function start({ rangeKey, readId }) {
    if (current) current.cancelled = true;
    const run = { readId, cancelled: false };
    current = run;
    const report = (msg) => chrome.runtime.sendMessage({ ...msg, readId }).catch(() => {});
    try {
      const range = MTD.delivery.rangeFor(rangeKey);
      if (location.origin !== MTD.delivery.AMAZON_ORIGIN || !range) {
        throw new MTD.amazonRead.ReadError('not-amazon');
      }
      const now = new Date();
      const result = await MTD.amazonRead.readAmazon({
        http: { request },
        parseHtml: (html) => new DOMParser().parseFromString(html, 'text/html'),
        today: localDay(now),
        days: range.days,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        onProgress: (progress) => {
          if (!run.cancelled) report({ type: 'read-progress', progress });
        },
        isCancelled: () => run.cancelled,
      });
      if (run.cancelled) return;
      const file = MTD.format.buildExport({
        transactions: result.transactions,
        orders: result.orders,
        rangeLabel: range.label,
        now,
      });
      await report({
        type: 'read-done',
        exportText: JSON.stringify(file, null, 2),
        summary: { count: file.transaction_count, rangeLabel: range.label, ...result.stats },
      });
    } catch (e) {
      if (!run.cancelled && !(e && e.code === 'cancelled')) {
        await report({ type: 'read-failed', code: (e && e.code) || 'layout' });
      }
    } finally {
      if (current === run) current = null;
    }
  }

  MTD.reader = { start };
})();
