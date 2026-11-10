/*
 * Runs on the Piggy Banks import page. In the tab "Send" opened, it asks the
 * background worker for the export and hands it to the page (lib/handoff.js).
 * Anywhere else, for instance when the user opened the import page
 * themselves, the background has nothing for it and it does nothing.
 *
 * Before posting, it asks the background again, and it stops when the
 * background says the delivery was cancelled: Cancel in the popup wins up
 * to the moment the export is posted.
 */
(async function () {
  'use strict';
  if (globalThis.__merchantDetailsDelivery) return;
  globalThis.__merchantDetailsDelivery = true;

  const handoff = globalThis.MTD && globalThis.MTD.handoff;
  if (!handoff) return;

  let claim = null;
  try {
    claim = await chrome.runtime.sendMessage({ type: 'claim-delivery' });
  } catch (_) {
    return;
  }
  if (!claim || typeof claim.payload !== 'string' || typeof claim.deliveryId !== 'string') return;
  const { deliveryId } = claim;

  const stop = new AbortController();
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id === chrome.runtime.id && !sender.tab && msg && msg.type === 'delivery-cancel') {
      if (msg.deliveryId === deliveryId) stop.abort();
    }
  });

  const outcome = await handoff.deliver({
    self: { window, origin: location.origin },
    payload: claim.payload,
    signal: stop.signal,
    stillWanted: () =>
      chrome.runtime.sendMessage({ type: 'delivery-wanted', deliveryId }).then((wanted) => wanted === true),
  });
  if (outcome === 'cancelled') return;
  chrome.runtime.sendMessage({ type: 'delivery-result', deliveryId, outcome }).catch(() => {});
})();
