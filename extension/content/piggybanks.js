/*
 * Runs on the Piggy Banks import page. In the tab "Send" opened, it asks the
 * background worker for the export and hands it to the page (lib/handoff.js).
 * Anywhere else, for instance when the user opened the import page
 * themselves, the background has nothing for it and it does nothing.
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

  const outcome = await handoff.deliver({
    self: { window, origin: location.origin },
    payload: claim.payload,
  });
  chrome.runtime
    .sendMessage({ type: 'delivery-result', deliveryId: claim.deliveryId, outcome })
    .catch(() => {});
})();
