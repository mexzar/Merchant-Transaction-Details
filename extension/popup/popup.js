/*
 * The popup: shows the state the background worker keeps and sends it
 * commands. Starting a read happens here because only the popup's click
 * grants the extension the Amazon tab (the activeTab permission).
 */
(async function () {
  'use strict';
  const D = globalThis.MTD.delivery;
  const F = globalThis.MTD.format;
  const $ = (id) => document.getElementById(id);

  const ORDERS_URL = 'https://www.amazon.com/your-orders/orders';
  const READER_FILES = [
    'lib/delivery.js',
    'lib/format.js',
    'lib/amazon-parse.js',
    'lib/amazon-read.js',
    'content/amazon-reader.js',
  ];
  const ERRORS = {
    'sign-in': "Amazon asked you to sign in or confirm it's you. Do that in the Amazon tab, then read again.",
    unavailable: "Amazon didn't answer as expected. Try again in a few minutes.",
    layout: "Couldn't read your Amazon pages. Amazon may have changed them.",
    network: "Couldn't reach Amazon. Check your connection, then try again.",
    'tab-closed': 'The Amazon tab closed before the read finished.',
    'too-large': "That's more than Piggy Banks takes at once. Pick a shorter range.",
    'not-amazon': 'Open Your Orders on amazon.com in this tab first.',
    'no-start': "Couldn't start reading in this tab. Reload the Amazon page, then try again.",
  };
  const STOPPED = {
    'sign-in': 'Amazon asked you to sign in partway through.',
    unavailable: 'Amazon stopped answering partway through.',
    layout: "Some order pages couldn't be read.",
    network: 'The connection dropped partway through.',
  };

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const onAmazon = !!tab && D.originOf(tab.url || '') === D.AMAZON_ORIGIN;
  let current = D.initialState();
  let localError = null;

  function show(id) {
    for (const section of document.querySelectorAll('main > section')) section.hidden = section.id !== id;
  }

  function plural(n, one, many) {
    return `${n} ${n === 1 ? one : many}`;
  }

  function render(state) {
    current = state || D.initialState();
    const s = current;
    if (localError) {
      $('error').textContent = ERRORS[localError] || ERRORS.layout;
      return show('failed');
    }
    switch (s.phase) {
      case 'reading': {
        const p = s.progress || { stage: 'payments', count: 0 };
        $('progress').textContent =
          p.stage === 'payments'
            ? `Reading Your Payments: ${plural(p.count, 'purchase', 'purchases')} so far.`
            : p.stage === 'orders'
              ? `Finding their orders: ${p.count} of ${p.of}.`
              : `Reading order details: ${p.count} of ${p.of} found.`;
        return show('reading');
      }
      case 'ready': {
        const m = s.summary || { count: 0 };
        $('summary').textContent = `${plural(m.count, 'charge or refund', 'charges and refunds')} from the ${(
          m.rangeLabel || ''
        ).toLowerCase()}.`;
        const caveats = [];
        if (m.paymentsCut) caveats.push('Your history is longer than one read covers. The oldest part is left out.');
        if (m.stopped && STOPPED[m.stopped]) caveats.push(STOPPED[m.stopped]);
        if (m.ordersNeeded > m.ordersFound) {
          caveats.push(
            `Products found for ${m.ordersFound} of ${plural(m.ordersNeeded, 'order', 'orders')}. The rest show the order number.`,
          );
        }
        $('caveats').replaceChildren(
          ...caveats.map((c) => {
            const li = document.createElement('li');
            li.textContent = c;
            return li;
          }),
        );
        $('notice').hidden = s.notice !== 'unreachable';
        $('notice').textContent =
          "Couldn't reach the Piggy Banks import page. Sign in to Piggy Banks in that tab, then click Send again.";
        $('send-button').disabled = !m.count;
        return show('ready');
      }
      case 'sending':
        return show('sending');
      case 'sent':
        return show('sent');
      case 'failed':
        $('error').textContent = ERRORS[s.error] || ERRORS.layout;
        return show('failed');
      default:
        return show(onAmazon ? 'start' : 'open-amazon');
    }
  }

  async function startRead() {
    localError = null;
    const rangeKey = $('range').value;
    const begun = await chrome.runtime.sendMessage({ type: 'read-begin', tabId: tab.id, rangeKey });
    if (!begun) return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: READER_FILES });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: (key) => {
          globalThis.MTD.reader.start({ rangeKey: key });
        },
        args: [rangeKey],
      });
    } catch (_) {
      await chrome.runtime.sendMessage({ type: 'cancel' });
      localError = 'no-start';
      render(current);
    }
  }

  function save() {
    if (!current.exportText) return;
    const url = URL.createObjectURL(new Blob([current.exportText], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = F.exportFileName(new Date());
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function setTestSite(on) {
    const origins = [`${D.TEST_ORIGIN}/*`];
    if (on) {
      const granted = await chrome.permissions.request({ origins });
      await chrome.storage.local.set({ target: granted ? 'test' : 'production' });
      $('test-site').checked = granted;
    } else {
      await chrome.storage.local.set({ target: 'production' });
      await chrome.permissions.remove({ origins }).catch(() => {});
    }
  }

  $('open-amazon-button').addEventListener('click', () => chrome.tabs.create({ url: ORDERS_URL }));
  $('read-button').addEventListener('click', startRead);
  $('stop-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
  $('send-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'send' }));
  $('save-button').addEventListener('click', save);
  $('discard-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'discard' }));
  $('cancel-send-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
  $('done-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'discard' }));
  $('retry-button').addEventListener('click', () => {
    localError = null;
    chrome.runtime.sendMessage({ type: 'discard' });
    render(current);
  });
  $('test-site').addEventListener('change', (e) => setTestSite(e.target.checked));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.state) render(changes.state.newValue);
  });

  const { target } = await chrome.storage.local.get('target');
  const testAllowed = await chrome.permissions.contains({ origins: [`${D.TEST_ORIGIN}/*`] });
  $('test-site').checked = target === 'test' && testAllowed;

  const stored = await chrome.storage.session.get('state');
  render(stored.state);
})();
