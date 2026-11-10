/*
 * Background worker: keeps the state (in storage.session, so it lives in
 * memory and is gone when the browser closes), opens the Piggy Banks import
 * page on "Send", and hands the export only to the page in that tab.
 *
 * It is the only writer of the state. The popup reads it and sends commands;
 * the Amazon reader and the import page's content script send results.
 */
importScripts('lib/delivery.js');

const D = self.MTD.delivery;
const KEY = 'state';
const TEST_SCRIPT_ID = 'piggybanks-test-site';

let queue = Promise.resolve();

/** Run `change` on the current state, one change at a time, and save its result. */
function update(change) {
  const run = queue.then(async () => {
    const stored = await chrome.storage.session.get(KEY);
    const state = stored[KEY] || D.initialState();
    const result = await change(state);
    await chrome.storage.session.set({ [KEY]: state });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

function fromPopup(sender) {
  return sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('popup/popup.html');
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !msg || typeof msg.type !== 'string') return false;
  handle(msg, sender).then(
    (result) => respond(result === undefined ? null : result),
    () => respond(null),
  );
  return true;
});

async function handle(msg, sender) {
  switch (msg.type) {
    // From the popup.
    case 'read-begin':
      if (!fromPopup(sender)) return null;
      return update((s) => {
        if (s.phase === 'reading' || s.phase === 'sending') return false;
        if (!D.RANGES[msg.rangeKey] || !Number.isInteger(msg.tabId)) return false;
        Object.assign(s, D.initialState(), {
          phase: 'reading',
          read: { tabId: msg.tabId, rangeKey: msg.rangeKey, startedAt: Date.now() },
          progress: { stage: 'payments', count: 0 },
        });
        return true;
      });
    case 'send':
      if (!fromPopup(sender)) return null;
      return startDelivery();
    case 'cancel':
      if (!fromPopup(sender)) return null;
      return update((s) => {
        if (s.phase === 'reading') {
          if (s.read) chrome.tabs.sendMessage(s.read.tabId, { type: 'read-cancel' }).catch(() => {});
          Object.assign(s, D.initialState());
        } else if (s.phase === 'sending') {
          s.phase = 'ready';
          s.delivery = null;
        }
      });
    case 'discard':
      if (!fromPopup(sender)) return null;
      return update((s) => {
        if (s.phase === 'reading' || s.phase === 'sending') return;
        Object.assign(s, D.initialState());
      });

    // From the Amazon reader.
    case 'read-progress':
    case 'read-done':
    case 'read-failed':
      return update((s) => {
        if (!D.isReaderSender(s, sender)) return;
        if (msg.type === 'read-progress') {
          s.progress = msg.progress;
        } else if (msg.type === 'read-failed') {
          Object.assign(s, D.initialState(), { phase: 'failed', error: String(msg.code || 'layout') });
        } else if (typeof msg.exportText !== 'string' || D.utf8Bytes(msg.exportText) > D.MAX_EXPORT_BYTES) {
          Object.assign(s, D.initialState(), { phase: 'failed', error: 'too-large' });
        } else {
          s.phase = 'ready';
          s.read = null;
          s.progress = null;
          s.exportText = msg.exportText;
          s.summary = msg.summary || null;
        }
      });

    // From the import page's content script.
    case 'claim-delivery':
      return update((s) => D.claim(s, sender, Date.now()));
    case 'delivery-result':
      return update((s) => {
        if (!s.delivery || msg.deliveryId !== s.delivery.id || !D.claim(s, sender, Date.now())) return;
        if (msg.outcome === 'received') {
          s.phase = 'sent';
          s.exportText = null;
          s.delivery = null;
          s.notice = null;
        } else {
          s.phase = 'ready';
          s.notice = 'unreachable';
        }
      });
    default:
      return null;
  }
}

/** Open the import page (in the tab used last time, if it is still open) and wait for it to ask. */
async function startDelivery() {
  const { target } = await chrome.storage.local.get('target');
  const testAllowed = await chrome.permissions.contains({ origins: [`${D.TEST_ORIGIN}/*`] });
  const site = target === 'test' && testAllowed ? 'test' : 'production';
  const url = D.importUrl(site);
  return update(async (s) => {
    if (s.phase !== 'ready' || !s.exportText) return false;
    let tabId = s.delivery && s.delivery.tabId;
    if (tabId === undefined || tabId === null) tabId = s.lastDeliveryTabId;
    let tab = null;
    if (Number.isInteger(tabId)) {
      tab = await chrome.tabs.update(tabId, { url, active: true }).catch(() => null);
    }
    if (!tab) tab = await chrome.tabs.create({ url, active: true });
    s.phase = 'sending';
    s.notice = null;
    s.lastDeliveryTabId = tab.id;
    s.delivery = { id: crypto.randomUUID(), tabId: tab.id, startedAt: Date.now(), target: site };
    return true;
  });
}

// A read whose tab closes, or navigates away, can never finish.
chrome.tabs.onRemoved.addListener((tabId) => {
  update((s) => {
    if (s.phase === 'reading' && s.read && s.read.tabId === tabId) {
      Object.assign(s, D.initialState(), { phase: 'failed', error: 'tab-closed' });
    }
    if (s.phase === 'sending' && s.delivery && s.delivery.tabId === tabId) {
      s.phase = 'ready';
      s.delivery = null;
      s.notice = 'unreachable';
    }
  });
});

// The test site is opt-in (Settings in the popup): its permission is
// optional, and its content script is registered only while it is granted.
async function syncTestSiteScript() {
  const granted = await chrome.permissions.contains({ origins: [`${D.TEST_ORIGIN}/*`] });
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [TEST_SCRIPT_ID] });
  if (granted && !existing.length) {
    await chrome.scripting.registerContentScripts([
      {
        id: TEST_SCRIPT_ID,
        matches: [`${D.TEST_ORIGIN}${D.IMPORT_PATH}*`],
        js: ['lib/handoff.js', 'content/piggybanks.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      },
    ]);
  } else if (!granted && existing.length) {
    await chrome.scripting.unregisterContentScripts({ ids: [TEST_SCRIPT_ID] });
  }
}

chrome.permissions.onAdded.addListener(() => syncTestSiteScript().catch(() => {}));
chrome.permissions.onRemoved.addListener(() => syncTestSiteScript().catch(() => {}));
chrome.runtime.onInstalled.addListener(() => syncTestSiteScript().catch(() => {}));
chrome.runtime.onStartup.addListener(() => syncTestSiteScript().catch(() => {}));
