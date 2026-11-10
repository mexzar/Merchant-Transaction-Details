import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MTD } from './load.js';

const { deliver, envelope, readReply, CHANNEL, VERSION } = MTD.handoff;
const ORIGIN = 'https://piggybanksonline.com';

/**
 * The import page's side as a stand-in: hears what the tool posts on the
 * window and answers the way Piggy Banks documents (posts on the same
 * window, to its own origin).
 */
function fakePage({ answersHello = true, takesDeliveries = true } = {}) {
  const win = new EventTarget();
  const heard = [];
  const reply = (data, from = { origin: ORIGIN, source: win }) =>
    win.dispatchEvent(new MessageEvent('message', { data, ...from }));
  win.postMessage = (data, targetOrigin) => {
    heard.push({ data, targetOrigin });
    // The tool hears its own posts too, as on a real window.
    queueMicrotask(() => {
      reply(data);
      if (data.type === 'hello' && answersHello) reply(envelope('ready'));
      if (data.type === 'deliver' && takesDeliveries) reply(envelope('received'));
    });
  };
  return { win, heard, reply };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('the message shape', () => {
  it('is the one Piggy Banks pins', () => {
    expect(CHANNEL).toBe('piggybanks.merchant-details');
    expect(VERSION).toBe(1);
    expect(envelope('deliver', '{}')).toEqual({
      channel: 'piggybanks.merchant-details',
      version: 1,
      type: 'deliver',
      payload: '{}',
    });
    expect(envelope('hello')).toEqual({ channel: 'piggybanks.merchant-details', version: 1, type: 'hello' });
  });

  it("hears only the page's own window on its own origin", () => {
    const win = {};
    const self = { window: win, origin: ORIGIN };
    const ready = envelope('ready');
    expect(readReply({ origin: ORIGIN, source: win, data: ready }, self)).toBe('ready');
    expect(readReply({ origin: 'https://evil.example', source: win, data: ready }, self)).toBeNull();
    expect(readReply({ origin: ORIGIN, source: {}, data: ready }, self)).toBeNull();
    expect(readReply({ origin: ORIGIN, source: win, data: { ...ready, version: 2 } }, self)).toBeNull();
    expect(readReply({ origin: ORIGIN, source: win, data: { ...ready, channel: 'x' } }, self)).toBeNull();
    expect(readReply({ origin: ORIGIN, source: win, data: envelope('hello') }, self)).toBeNull();
    expect(readReply({ origin: ORIGIN, source: win, data: 'ready' }, self)).toBeNull();
  });
});

describe('deliver', () => {
  it('says hello, delivers once on ready, and finishes on received', async () => {
    const page = fakePage();
    const outcome = deliver({ self: { window: page.win, origin: ORIGIN }, payload: '{"x":1}' });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('received');
    expect(page.heard.map((h) => h.data.type)).toEqual(['hello', 'deliver']);
    expect(page.heard[1].data.payload).toBe('{"x":1}');
    expect(page.heard.every((h) => h.targetOrigin === ORIGIN)).toBe(true);
  });

  it('delivers on a ready the page sends by itself', async () => {
    const page = fakePage({ answersHello: false });
    const outcome = deliver({ self: { window: page.win, origin: ORIGIN }, payload: '{}' });
    page.reply(envelope('ready'));
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('received');
    expect(page.heard.filter((h) => h.data.type === 'deliver')).toHaveLength(1);
  });

  it('gives up when the page never answers', async () => {
    const page = fakePage({ answersHello: false });
    const outcome = deliver({ self: { window: page.win, origin: ORIGIN }, payload: '{}', maxHellos: 5 });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('unreachable');
    expect(page.heard.map((h) => h.data.type)).toEqual(['hello', 'hello', 'hello', 'hello', 'hello']);
  });

  it('asks again after a delivery the page dropped, and stops after a few', async () => {
    const page = fakePage({ takesDeliveries: false });
    const outcome = deliver({ self: { window: page.win, origin: ORIGIN }, payload: '{}', maxDeliveries: 2 });
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('unreachable');
    expect(page.heard.map((h) => h.data.type)).toEqual(['hello', 'deliver', 'hello', 'deliver', 'hello']);
  });

  it('ignores a ready or received from anywhere else', async () => {
    const page = fakePage({ answersHello: false });
    const outcome = deliver({ self: { window: page.win, origin: ORIGIN }, payload: '{}', maxHellos: 3 });
    page.reply(envelope('ready'), { origin: 'https://evil.example', source: page.win });
    page.reply(envelope('ready'), { origin: ORIGIN, source: {} });
    page.reply(envelope('received'));
    await vi.runAllTimersAsync();
    await expect(outcome).resolves.toBe('unreachable');
    expect(page.heard.some((h) => h.data.type === 'deliver')).toBe(false);
  });
});
