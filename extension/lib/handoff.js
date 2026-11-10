/*
 * The tool's half of the Piggy Banks handoff: hand the export to the
 * Piggy Banks import page open in this tab, through window.postMessage.
 * Piggy Banks documents the page's half (Specs/MERCHANT_DETAILS_IMPORT.md in
 * its repo).
 *
 * Every message, both ways:
 *
 *   { channel: 'piggybanks.merchant-details', version: 1, type, payload? }
 *
 *   tool → page   hello      "are you there?"
 *   page → tool   ready      mounted, signed in and idle (also sent unasked on mount)
 *   tool → page   deliver    payload: the export, as JSON text
 *   page → tool   received   taken; do not send it again
 *
 * The page answers nothing while an import runs, nothing when signed out
 * (the page is not there), and never reports results: those show on the
 * page. So silence means "try again later", and the tool keeps the export
 * until it hears `received`.
 *
 * Only replies from the page's own window on its own origin count, and the
 * tool posts only to that origin.
 */
(function (root) {
  'use strict';
  const MTD = (root.MTD = root.MTD || {});

  const CHANNEL = 'piggybanks.merchant-details';
  const VERSION = 1;

  function envelope(type, payload) {
    const msg = { channel: CHANNEL, version: VERSION, type };
    if (payload !== undefined) msg.payload = payload;
    return msg;
  }

  /** `ready`, `received`, or null for anything else (our own posts included). */
  function readReply(event, self) {
    if (event.origin !== self.origin || event.source !== self.window) return null;
    const data = event.data;
    if (typeof data !== 'object' || data === null || Array.isArray(data)) return null;
    if (data.channel !== CHANNEL || data.version !== VERSION) return null;
    return data.type === 'ready' || data.type === 'received' ? data.type : null;
  }

  /**
   * Deliver `payload` to the page in `self.window`. Resolves `received` once
   * the page has taken it, `unreachable` when the page never answered, or
   * `cancelled` when the user cancelled (`signal`, or `stillWanted` saying
   * no).
   *
   * Says `hello` every `helloEveryMs` until `ready` (or a ready the page sent
   * by itself). Then asks `stillWanted()`, so a delivery cancelled since it
   * started is never posted, posts `deliver` once and waits
   * `receivedWithinMs` for `received`. The page posts `received` before it
   * imports, so a delivery that hears nothing was dropped (an import was
   * running), and saying `hello` again is safe; a late `received` still
   * counts. Gives up after `maxHellos` hellos or `maxDeliveries` deliveries.
   */
  function deliver({
    self,
    payload,
    stillWanted = () => true,
    signal,
    helloEveryMs = 1000,
    maxHellos = 20,
    receivedWithinMs = 5000,
    maxDeliveries = 3,
    timers = root,
  }) {
    return new Promise((resolve) => {
      let hellos = 0;
      let deliveries = 0;
      let waiting = false;
      let timer = null;
      let done = false;

      const post = (msg) => self.window.postMessage(msg, self.origin);

      function finish(outcome) {
        if (done) return;
        done = true;
        timers.clearTimeout(timer);
        self.window.removeEventListener('message', onMessage);
        resolve(outcome);
      }

      function sayHello() {
        if (done || waiting) return;
        if (hellos >= maxHellos) return finish('unreachable');
        hellos++;
        post(envelope('hello'));
        timer = timers.setTimeout(sayHello, helloEveryMs);
      }

      function onMessage(event) {
        const reply = readReply(event, self);
        if (done || !reply) return;
        if (reply === 'received') {
          if (deliveries > 0) finish('received');
          return;
        }
        if (waiting) return;
        if (deliveries >= maxDeliveries) return finish('unreachable');
        waiting = true;
        timers.clearTimeout(timer);
        Promise.resolve()
          .then(stillWanted)
          .catch(() => false)
          .then((wanted) => {
            if (done) return;
            if (!wanted) return finish('cancelled');
            deliveries++;
            post(envelope('deliver', payload));
            timer = timers.setTimeout(() => {
              waiting = false;
              sayHello();
            }, receivedWithinMs);
          });
      }

      if (signal) {
        if (signal.aborted) return resolve('cancelled');
        signal.addEventListener('abort', () => finish('cancelled'), { once: true });
      }
      self.window.addEventListener('message', onMessage);
      sayHello();
    });
  }

  MTD.handoff = { CHANNEL, VERSION, envelope, readReply, deliver };
})(globalThis);
