import { describe, expect, it } from 'vitest';
import { MTD } from './load.js';

const { truncateProductName, composeDescription, buildExport, exportFileName, MAX_DESCRIPTION } = MTD.format;

// The same cases as the desktop app's tests (tests/test_scaffold.py), so the
// two keep writing the same descriptions.
describe('truncateProductName', () => {
  it('drops everything after the first comma', () => {
    expect(truncateProductName("ASICS Men's NOVABLAST 5 Running Shoes, 10, Arctic Blue/Aegean Blue")).toBe(
      "ASICS Men's NOVABLAST 5 Running Shoes",
    );
  });

  it('caps at 60 characters on a word, without a trailing separator', () => {
    expect(
      truncateProductName("Brooks Men's Ghost 17 Neutral Running Shoe - Peacoat/Lime/Blue - 10 Medium"),
    ).toBe("Brooks Men's Ghost 17 Neutral Running Shoe…");
  });

  it('passes a short title through', () => {
    expect(truncateProductName('Crayola Dry Erase Marker')).toBe('Crayola Dry Erase Marker');
  });

  it('counts characters, not UTF-16 units, and never splits an emoji', () => {
    const title = `${'😀'.repeat(59)}x${'😀'.repeat(5)}`;
    const out = truncateProductName(title);
    expect(out.endsWith('…')).toBe(true);
    expect(out.isWellFormed()).toBe(true);
  });
});

describe('composeDescription', () => {
  it('lists each product on its own line, then the order number', () => {
    const order = {
      items: [
        { title: "ASICS Men's NOVABLAST 5 Running Shoes, 10, Arctic Blue/Aegean Blue" },
        { title: "Brooks Men's Ghost 17 Neutral Running Shoe - Peacoat/Lime/Blue - 10 Medium" },
      ],
    };
    expect(composeDescription({ amount: -372.22, orderNumber: '111-0000000-0000001' }, order)).toBe(
      "ASICS Men's NOVABLAST 5 Running Shoes\nBrooks Men's Ghost 17 Neutral Running Shoe… - order 111-0000000-0000001",
    );
  });

  it('starts a refund with "Return of "', () => {
    const order = { items: [{ title: 'kate spade new york Womens Kiya/S Square Sunglasses, Peach, 53mm' }] };
    const desc = composeDescription({ amount: 94.95, orderNumber: '111-0000000-0000002' }, order);
    expect(desc).toBe('Return of kate spade new york Womens Kiya/S Square Sunglasses - order 111-0000000-0000002');
  });

  it('puts a quantity over one in front of the product', () => {
    const order = { items: [{ title: 'Crayola Dry Erase Marker', quantity: 3 }] };
    expect(composeDescription({ amount: -44.97, orderNumber: 'X-1' }, order)).toBe(
      '3x Crayola Dry Erase Marker - order X-1',
    );
  });

  it('falls back to the seller when there is no order', () => {
    expect(composeDescription({ amount: -6.48, seller: 'Prime Video TVOD' }, null)).toBe('Prime Video TVOD');
  });

  it('skips a generic card descriptor for the order number alone', () => {
    const charge = { amount: -101.42, orderNumber: '111-0000000-0000003', seller: 'AMZN Mktp US' };
    expect(composeDescription(charge, null)).toBe('Order 111-0000000-0000003');
    const refund = { amount: 10.81, orderNumber: '111-0000000-0000003', seller: 'Amazon.com*AB12CD' };
    expect(composeDescription(refund, null)).toBe('Refund on order 111-0000000-0000003');
  });

  it('says "(unknown)" with nothing to go on', () => {
    expect(composeDescription({ amount: -1 }, null)).toBe('(unknown)');
  });

  it('skips products with no title', () => {
    const order = { items: [{ title: '', quantity: 2 }, { title: 'Tape' }] };
    expect(composeDescription({ amount: -2, orderNumber: 'X-2' }, order)).toBe('Tape - order X-2');
  });

  it('keeps a long order under the Piggy Banks limit, order number included', () => {
    const items = Array.from({ length: 12 }, (_, i) => ({
      title: `Product number ${i + 1} with a long and very descriptive Amazon title that runs on`,
    }));
    const desc = composeDescription({ amount: -500, orderNumber: '111-0000000-0000004' }, { items });
    expect(desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(desc.endsWith(' - order 111-0000000-0000004')).toBe(true);
    expect(desc).toMatch(/\n\+\d+ more - order /);
    expect(desc.startsWith('Product number 1 with')).toBe(true);
  });

  it('keeps a long refund under the limit too', () => {
    const items = Array.from({ length: 9 }, (_, i) => ({ title: `${'Long title '.repeat(5)}${i}` }));
    const desc = composeDescription({ amount: 20, orderNumber: '111-0000000-0000005' }, { items });
    expect(desc.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
    expect(desc.startsWith('Return of ')).toBe(true);
    expect(desc.endsWith(' - order 111-0000000-0000005')).toBe(true);
  });
});

describe('buildExport', () => {
  it('writes the shape Piggy Banks and the desktop app share', () => {
    const now = new Date('2026-11-10T18:00:00Z');
    const orders = new Map([['111-0000000-0000001', { items: [{ title: 'Swim Goggles' }] }]]);
    const file = buildExport({
      transactions: [
        { date: '2026-11-08', amount: -34.63, orderNumber: '111-0000000-0000001', seller: 'AMZN Mktp US' },
        { date: '2026-11-07', amount: -5, orderNumber: null, seller: 'Kindle Unlimited' },
      ],
      orders,
      rangeLabel: 'Last 3 months',
      now,
    });
    expect(file).toEqual({
      merchant: 'amazon',
      generated_at: '2026-11-10T18:00:00.000Z',
      range_label: 'Last 3 months',
      transaction_count: 2,
      transactions: [
        { merchant: 'Amazon', date: '2026-11-08', amount: -34.63, description: 'Swim Goggles - order 111-0000000-0000001' },
        { merchant: 'Amazon', date: '2026-11-07', amount: -5, description: 'Kindle Unlimited' },
      ],
    });
  });

  it('names the file like the desktop app does', () => {
    expect(exportFileName(new Date(2026, 10, 10, 14, 22, 33))).toBe('amazon-transactions-20261110-142233.json');
  });
});
