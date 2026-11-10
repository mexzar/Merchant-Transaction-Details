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
// How long after a read starts before a reader that does not answer counts
// as gone (the popup may still be injecting it).
const READER_GRACE_MS = 5000;
// How long after the Amazon tab starts loading a page to check the reader:
// a real navigation has removed it by then; an in-page one has not.
const NAVIGATION_CHECK_MS = 1500;

let queue = Promise.resolve();

/** Run `change` on the current state, one change at a time, and save it. */
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

function tell(tabId, msg) {
  return chrome.tabs.sendMessage(tabId, msg, { frameId: 0 });
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
        if (s.phase === 'reading' || s.phase === 'sending') return null;
        if (!D.rangeFor(msg.rangeKey) || !Number.isInteger(msg.tabId)) return null;
        const read = { id: crypto.randomUUID(), tabId: msg.tabId, rangeKey: msg.rangeKey, startedAt: Date.now() };
        Object.assign(s, D.initialState(), { phase: 'reading', read, progress: { stage: 'payments', count: 0 } });
        return { readId: read.id };
      });
    case 'check-read':
      if (!fromPopup(sender)) return null;
      return checkReader(READER_GRACE_MS);
    case 'send':
      if (!fromPopup(sender)) return null;
      return startDelivery();
    case 'cancel':
      if (!fromPopup(sender)) return null;
      return update((s) => {
        if (s.phase === 'reading') {
          if (s.read) tell(s.read.tabId, { type: 'read-cancel', readId: s.read.id }).catch(() => {});
          Object.assign(s, D.initialState());
        } else if (s.phase === 'sending') {
          cancelDelivery(s);
          s.phase = 'ready';
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
        if (!D.isReaderSender(s, sender, msg.readId)) return;
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
    case 'delivery-wanted':
      return update((s) => D.stillWanted(s, sender, msg.deliveryId, Date.now()));
    case 'delivery-result':
      return update((s) => {
        if (!D.stillWanted(s, sender, msg.deliveryId, Date.now())) return;
        s.delivery = null;
        if (msg.outcome === 'received') {
          s.phase = 'sent';
          s.notice = null;
        } else if (msg.outcome === 'unreachable') {
          s.phase = 'ready';
          s.notice = 'unreachable';
        }
      });
    default:
      return null;
  }
}

/** Tell the import page's content script to stop, and forget the delivery. */
function cancelDelivery(s) {
  if (s.delivery) tell(s.delivery.tabId, { type: 'delivery-cancel', deliveryId: s.delivery.id }).catch(() => {});
  s.delivery = null;
}

/**
 * Open the import page in a new tab and wait for it to ask. Always a new
 * tab: an earlier one may since be showing something else.
 */
async function startDelivery() {
  const toTest = await chrome.permissions.contains({ origins: [`${D.TEST_ORIGIN}/*`] });
  const site = toTest ? 'test' : 'production';
  return update(async (s) => {
    if (!['ready', 'sending', 'sent'].includes(s.phase) || !s.exportText) return false;
    cancelDelivery(s);
    const tab = await chrome.tabs.create({ url: D.importUrl(site), active: true });
    s.phase = 'sending';
    s.notice = null;
    s.delivery = { id: crypto.randomUUID(), tabId: tab.id, startedAt: Date.now(), target: site };
    return true;
  });
}

/**
 * If the current read's reader no longer answers (its tab left the page),
 * the read failed. `graceMs` spares a read that may still be being injected.
 */
async function checkReader(graceMs) {
  const { [KEY]: s } = await chrome.storage.session.get(KEY);
  if (!s || s.phase !== 'reading' || !s.read || Date.now() - s.read.startedAt < graceMs) return;
  const { id, tabId } = s.read;
  const alive = await tell(tabId, { type: 'read-ping', readId: id }).then(
    (answer) => answer === true,
    () => false,
  );
  if (alive) return;
  await update((now) => {
    if (now.phase === 'reading' && now.read && now.read.id === id) {
      Object.assign(now, D.initialState(), { phase: 'failed', error: 'tab-left' });
    }
  });
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== 'loading') return;
  chrome.storage.session.get(KEY).then(({ [KEY]: s }) => {
    if (s && s.phase === 'reading' && s.read && s.read.tabId === tabId) {
      setTimeout(() => checkReader(0).catch(() => {}), NAVIGATION_CHECK_MS);
    }
  });
});

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
// optional, its content script is registered only while it is granted, and
// while it is granted, Send goes there.
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
