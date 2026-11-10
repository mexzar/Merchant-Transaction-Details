import { describe, expect, it } from 'vitest';
import { MTD } from './load.js';

const D = MTD.delivery;
const NOW = 1_800_000_000_000;

function sending(overrides = {}) {
  return {
    ...D.initialState(),
    phase: 'sending',
    exportText: '{"transactions":[]}',
    delivery: { id: 'd-1', tabId: 7, startedAt: NOW - 1000, target: 'production' },
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

  it('gives nothing to the test site unless that is where it was sent', () => {
    const test = { ...importPage, origin: D.TEST_ORIGIN, url: `${D.TEST_ORIGIN}/import-details` };
    expect(D.claim(sending(), test, NOW)).toBeNull();
    const toTest = sending({ delivery: { id: 'd-2', tabId: 7, startedAt: NOW, target: 'test' } });
    expect(D.claim(toTest, test, NOW)).toEqual({ deliveryId: 'd-2', payload: '{"transactions":[]}' });
    expect(D.claim(toTest, importPage, NOW)).toBeNull();
  });

  it('gives nothing when not sending, or long after Send', () => {
    expect(D.claim(sending({ phase: 'ready' }), importPage, NOW)).toBeNull();
    expect(D.claim(sending({ exportText: null }), importPage, NOW)).toBeNull();
    expect(D.claim(sending(), importPage, NOW + 16 * 60 * 1000)).toBeNull();
  });
});

describe('isReaderSender', () => {
  const reading = { ...D.initialState(), phase: 'reading', read: { tabId: 3, rangeKey: 'months-3', startedAt: NOW } };
  const amazonTab = { tab: { id: 3 }, frameId: 0, origin: 'https://www.amazon.com', url: 'https://www.amazon.com/your-orders/orders' };

  it('hears only the top frame of the tab the read started in, on Amazon', () => {
    expect(D.isReaderSender(reading, amazonTab)).toBe(true);
    expect(D.isReaderSender(reading, { ...amazonTab, tab: { id: 4 } })).toBe(false);
    expect(D.isReaderSender(reading, { ...amazonTab, frameId: 1 })).toBe(false);
    expect(D.isReaderSender(reading, { ...amazonTab, origin: 'https://smile.amazon.com' })).toBe(false);
    expect(D.isReaderSender({ ...reading, phase: 'ready' }, amazonTab)).toBe(false);
  });
});

describe('importUrl', () => {
  it('sends to production unless the test site was chosen', () => {
    expect(D.importUrl('production')).toBe('https://piggybanksonline.com/import-details');
    expect(D.importUrl('test')).toBe(`${D.TEST_ORIGIN}/import-details`);
  });
});
