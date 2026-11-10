/*
 * Injected into the user's Amazon tab when they click "Read my Amazon
 * purchases" (and only then: the extension has no standing access to
 * Amazon). Reads as that tab, with the user's own session, builds the export
 * and gives it to the background worker. Nothing is sent anywhere else.
 */
(function () {
  'use strict';
  const MTD = globalThis.MTD;
  // Injected again into a tab that already has it: the first copy answers.
  if (MTD.reader) return;

  let running = false;
  let cancelled = false;

  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id === chrome.runtime.id && !sender.tab && msg && msg.type === 'read-cancel') {
      cancelled = true;
    }
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

  async function start({ rangeKey }) {
    if (running) return;
    running = true;
    cancelled = false;
    const report = (msg) => chrome.runtime.sendMessage(msg).catch(() => {});
    try {
      const range = MTD.delivery.RANGES[rangeKey];
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
        onProgress: (progress) => report({ type: 'read-progress', progress }),
        isCancelled: () => cancelled,
      });
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
      if (!(e && e.code === 'cancelled')) await report({ type: 'read-failed', code: (e && e.code) || 'layout' });
    } finally {
      running = false;
    }
  }

  MTD.reader = { start };
})();
