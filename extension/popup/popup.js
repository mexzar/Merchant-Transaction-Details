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
  const TEST_ORIGINS = [`${D.TEST_ORIGIN}/*`];
  // The extension reads Amazon in the background of the tab, so a sign-in or
  // CAPTCHA page it meets is not on screen: reloading the tab brings it up.
  const ERRORS = {
    'sign-in': "Amazon wants you to sign in or confirm it's you. Reload the Amazon tab, do what it asks, then read again.",
    unavailable: "Amazon didn't answer as expected. Try again in a few minutes.",
    layout: "Couldn't read your Amazon pages. Amazon may have changed them, or this account isn't in English.",
    network: "Couldn't reach Amazon. Check your connection, then try again.",
    'tab-closed': 'The Amazon tab closed before the read finished.',
    'tab-left': 'The Amazon tab left the page before the read finished. Read again, and leave that tab open until it is done.',
    'too-large': "That's more than Piggy Banks takes at once. Pick a shorter range.",
    'not-amazon': 'Open Your Orders on amazon.com in this tab first.',
    'no-start': "Couldn't start reading in this tab. Reload the Amazon page, then try again.",
  };
  const STOPPED = {
    'sign-in': 'Amazon asked you to sign in partway through. Reload the Amazon tab and read again to fill in the rest.',
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
        if (m.stopped && Object.hasOwn(STOPPED, m.stopped)) caveats.push(STOPPED[m.stopped]);
        if (m.ordersNeeded > m.ordersFound) {
          caveats.push(
            `Product names found for ${m.ordersFound} of ${plural(m.ordersNeeded, 'order', 'orders')}. The rest have the seller or the order number instead.`,
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
        $('error').textContent = Object.hasOwn(ERRORS, s.error) ? ERRORS[s.error] : ERRORS.layout;
        return show('failed');
      default:
        return show(onAmazon ? 'start' : 'open-amazon');
    }
  }

  async function startRead() {
    localError = null;
    const rangeKey = $('range').value;
    const begun = await chrome.runtime.sendMessage({ type: 'read-begin', tabId: tab.id, rangeKey });
    if (!begun || typeof begun.readId !== 'string') return;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, world: 'ISOLATED', files: D.READER_FILES });
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'ISOLATED',
        func: (key, id) => {
          globalThis.MTD.reader.start({ rangeKey: key, readId: id });
        },
        args: [rangeKey, begun.readId],
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

  // The test-site setting is the optional permission itself: granted means
  // Send goes to the test site. The background reacts to the change, so it
  // holds even if the browser's prompt closes this popup.
  async function setTestSite(on) {
    if (on) {
      $('test-site').checked = await chrome.permissions.request({ origins: TEST_ORIGINS });
    } else {
      await chrome.permissions.remove({ origins: TEST_ORIGINS }).catch(() => {});
    }
  }

  const send = () => chrome.runtime.sendMessage({ type: 'send' });
  const discard = () => chrome.runtime.sendMessage({ type: 'discard' });
  $('open-amazon-button').addEventListener('click', () => chrome.tabs.create({ url: ORDERS_URL }));
  $('read-button').addEventListener('click', startRead);
  $('stop-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
  $('send-button').addEventListener('click', send);
  $('save-button').addEventListener('click', save);
  $('discard-button').addEventListener('click', discard);
  $('resend-button').addEventListener('click', send);
  $('cancel-send-button').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'cancel' }));
  $('done-button').addEventListener('click', discard);
  $('send-again-button').addEventListener('click', send);
  $('retry-button').addEventListener('click', () => {
    localError = null;
    discard();
    render(current);
  });
  $('test-site').addEventListener('change', (e) => setTestSite(e.target.checked));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'session' && changes.state) render(changes.state.newValue);
  });

  $('test-site').checked = await chrome.permissions.contains({ origins: TEST_ORIGINS });

  const stored = await chrome.storage.session.get('state');
  render(stored.state);
  // A read whose tab has since left the page shows as failed rather than
  // reading forever.
  if (stored.state && stored.state.phase === 'reading') chrome.runtime.sendMessage({ type: 'check-read' });
})();
