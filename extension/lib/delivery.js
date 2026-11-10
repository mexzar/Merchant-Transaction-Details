/*
 * The extension's state and the rules for who may change it. Shared by the
 * background worker (the only writer) and the popup (a reader). Pure.
 *
 * phase:
 *   idle      nothing read
 *   reading   reading Amazon in `read.tabId`
 *   ready     an export is waiting (`exportText`), not yet taken by Piggy Banks
 *   sending   handing it to the import page in `delivery.tabId`
 *   sent      Piggy Banks took it; the export is gone from the extension
 *   failed    the read stopped (`error`)
 */
(function (root) {
  'use strict';
  const MTD = (root.MTD = root.MTD || {});

  // The canonical Piggy Banks site. piggybanks.online is an alias whose pages
  // send the browser on to this one before the app loads, so the import page
  // only ever runs here.
  const PRODUCTION_ORIGINS = ['https://piggybanksonline.com'];
  const TEST_ORIGIN = 'https://jolly-ground-01e69fe0f.7.azurestaticapps.net';
  const IMPORT_PATH = '/import-details';
  const AMAZON_ORIGIN = 'https://www.amazon.com';

  // The import page must ask for the export within this long of "Send".
  const DELIVERY_WINDOW_MS = 15 * 60 * 1000;
  // Piggy Banks refuses an export over 8 MB (MAX_FILE_BYTES).
  const MAX_EXPORT_BYTES = 8 * 1024 * 1024;

  const RANGES = {
    last30: { label: 'Last 30 days', days: 30 },
    'months-3': { label: 'Last 3 months', days: 91 },
    'months-6': { label: 'Last 6 months', days: 182 },
    'months-12': { label: 'Last 12 months', days: 365 },
  };

  function initialState() {
    return {
      phase: 'idle',
      read: null, // { tabId, rangeKey, startedAt }
      progress: null, // { stage, count, of? }
      error: null,
      exportText: null,
      summary: null, // { count, rangeLabel, ordersNeeded, ordersFound, stopped, paymentsCut }
      delivery: null, // { id, tabId, startedAt, target }
      notice: null, // 'unreachable' after a send that heard nothing
    };
  }

  function originOf(url) {
    try {
      return new URL(url).origin;
    } catch (_) {
      return null;
    }
  }

  function importUrl(target) {
    return (target === 'test' ? TEST_ORIGIN : PRODUCTION_ORIGINS[0]) + IMPORT_PATH;
  }

  /** The origin a message came from: the frame's own, else its URL's. */
  function senderOrigin(sender) {
    return sender.origin || originOf(sender.url);
  }

  /**
   * True for a page on the Piggy Banks site a delivery was sent to. The
   * origin, not the path: the import page's content script is injected only
   * on /import-details, but the app may have moved the tab elsewhere since
   * (a signed-out visitor is sent to the landing page), and the handshake is
   * what tells the import page apart.
   */
  function isPiggyBanks(sender, target) {
    const origin = senderOrigin(sender);
    return target === 'test' ? origin === TEST_ORIGIN : PRODUCTION_ORIGINS.includes(origin);
  }

  /** The top frame of the tab a read was started in, on Amazon. */
  function isReaderSender(state, sender) {
    return (
      state.phase === 'reading' &&
      !!state.read &&
      !!sender.tab &&
      sender.tab.id === state.read.tabId &&
      sender.frameId === 0 &&
      senderOrigin(sender) === AMAZON_ORIGIN
    );
  }

  /**
   * What the import page in `sender` gets when it asks for the export: the
   * export and the delivery's id, or null. Only the tab "Send" opened, only
   * its top frame, only on the Piggy Banks site it was sent to, only while
   * sending, and only for a while.
   */
  function claim(state, sender, now) {
    const d = state.delivery;
    if (state.phase !== 'sending' || !d || !state.exportText) return null;
    if (!sender.tab || sender.tab.id !== d.tabId || sender.frameId !== 0) return null;
    if (!isPiggyBanks(sender, d.target)) return null;
    if (now - d.startedAt > DELIVERY_WINDOW_MS) return null;
    return { deliveryId: d.id, payload: state.exportText };
  }

  function utf8Bytes(text) {
    return new TextEncoder().encode(text).length;
  }

  MTD.delivery = {
    PRODUCTION_ORIGINS,
    TEST_ORIGIN,
    IMPORT_PATH,
    AMAZON_ORIGIN,
    MAX_EXPORT_BYTES,
    RANGES,
    initialState,
    importUrl,
    isPiggyBanks,
    isReaderSender,
    claim,
    originOf,
    utf8Bytes,
  };
})(globalThis);
