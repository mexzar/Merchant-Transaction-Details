import { describe, expect, it } from 'vitest';
import { MTD } from './load.js';

const D = MTD.delivery;
const NOW = 1_800_000_000_000;

function sending(overrides = {}) {
  return {
    ...D.initialState(),
    phase: 'sending',
    exportText: '{"transactions":[]}',
    delivery: { id: 'd-1', tabId: 7, startedAt: NOW - 1000 },
    ...overrides,
  };
}

const importPage = {
  tab: { id: 7 },
  frameId: 0,
  origin: 'https://piggybanksonline.com',
  url: 'https://piggybanksonline.com/import-details',
};

describe('claim', () => {
  it('gives the export to the import page in the tab Send opened', () => {
    expect(D.claim(sending(), importPage, NOW)).toEqual({ deliveryId: 'd-1', payload: '{"transactions":[]}' });
  });

  it('gives nothing to the alias domain, which only redirects', () => {
    const alias = { ...importPage, origin: 'https://piggybanks.online', url: 'https://piggybanks.online/import-details' };
    expect(D.claim(sending(), alias, NOW)).toBeNull();
  });

  it('gives nothing to another tab, a frame, or another site', () => {
    expect(D.claim(sending(), { ...importPage, tab: { id: 8 } }, NOW)).toBeNull();
    expect(D.claim(sending(), { ...importPage, frameId: 3 }, NOW)).toBeNull();
    expect(D.claim(sending(), { ...importPage, origin: 'https://evil.example', url: 'https://evil.example/import-details' }, NOW)).toBeNull();
    expect(D.claim(sending(), { ...importPage, tab: undefined }, NOW)).toBeNull();
  });

  it('gives nothing when not sending, or long after Send', () => {
    expect(D.claim(sending({ phase: 'ready' }), importPage, NOW)).toBeNull();
    expect(D.claim(sending({ exportText: null }), importPage, NOW)).toBeNull();
    expect(D.claim(sending(), importPage, NOW + 16 * 60 * 1000)).toBeNull();
  });
});

describe('stillWanted', () => {
  it('says yes only for the current delivery, while it is still being sent', () => {
    expect(D.stillWanted(sending(), importPage, 'd-1', NOW)).toBe(true);
    expect(D.stillWanted(sending(), importPage, 'd-0', NOW)).toBe(false);
    // Cancel puts the export back to ready.
    expect(D.stillWanted(sending({ phase: 'ready', delivery: null }), importPage, 'd-1', NOW)).toBe(false);
  });
});

describe('isReaderSender', () => {
  const reading = {
    ...D.initialState(),
    phase: 'reading',
    read: { id: 'r-2', tabId: 3, rangeKey: 'months-3', startedAt: NOW },
  };
  const amazonTab = { tab: { id: 3 }, frameId: 0, origin: 'https://www.amazon.com', url: 'https://www.amazon.com/your-orders/orders' };

  it('hears only the current read, from the top frame of its tab, on Amazon', () => {
    expect(D.isReaderSender(reading, amazonTab, 'r-2')).toBe(true);
    expect(D.isReaderSender(reading, amazonTab, 'r-1')).toBe(false);
    expect(D.isReaderSender(reading, amazonTab, undefined)).toBe(false);
    expect(D.isReaderSender(reading, { ...amazonTab, tab: { id: 4 } }, 'r-2')).toBe(false);
    expect(D.isReaderSender(reading, { ...amazonTab, frameId: 1 }, 'r-2')).toBe(false);
    expect(D.isReaderSender(reading, { ...amazonTab, origin: 'https://smile.amazon.com' }, 'r-2')).toBe(false);
    expect(D.isReaderSender({ ...reading, phase: 'ready' }, amazonTab, 'r-2')).toBe(false);
  });
});

describe('rangeFor', () => {
  it('knows the four ranges and nothing else', () => {
    expect(D.rangeFor('months-3')).toEqual({ label: 'Last 3 months', days: 91 });
    expect(D.rangeFor('constructor')).toBeNull();
    expect(D.rangeFor('toString')).toBeNull();
    expect(D.rangeFor(undefined)).toBeNull();
  });
});

describe('IMPORT_URL', () => {
  it('is the import page on the canonical Piggy Banks site', () => {
    expect(D.IMPORT_URL).toBe('https://piggybanksonline.com/import-details');
  });
});
