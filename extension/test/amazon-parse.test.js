import { describe, expect, it } from 'vitest';
import { MTD, fixture, parseHtml } from './load.js';
import { CAPTCHA, SIGN_IN, SORRY, WAF } from './fixtures/blocked.js';

const P = MTD.amazonParse;

describe('parseDate and parseAmount', () => {
  it('reads the dates Amazon writes', () => {
    expect(P.parseDate('Mar 16, 2026')).toBe('2026-03-16');
    expect(P.parseDate('November 5, 2026')).toBe('2026-11-05');
    expect(P.parseDate('Sept. 1, 2026')).toBe('2026-09-01');
    expect(P.parseDate('Order placed February 30, 2026')).toBeNull();
    expect(P.parseDate('yesterday')).toBeNull();
  });

  it('reads the amounts Amazon writes, in cents', () => {
    expect(P.parseAmount('-$45.68')).toBe(-45.68);
    expect(P.parseAmount('+$52.62')).toBe(52.62);
    expect(P.parseAmount('-CA$12.34')).toBe(-12.34);
    expect(P.parseAmount('($1.99)')).toBe(-1.99);
    expect(P.parseAmount('-$1,204.5')).toBe(-1204.5);
    expect(P.parseAmount('$0.10')).toBe(0.1);
    expect(P.parseAmount('')).toBeNull();
    expect(P.parseAmount(undefined)).toBeNull();
  });

  it('finds order numbers of every shape', () => {
    expect(P.orderNumberIn('Order #111-0000000-0000001')).toBe('111-0000000-0000001');
    expect(P.orderNumberIn('Order #D01-0000000-0000003')).toBe('D01-0000000-0000003');
    expect(P.orderNumberIn('Order #0000000019080621061')).toBe('0000000019080621061');
    expect(P.orderNumberIn('No order here')).toBeNull();
  });
});

describe('blockedReason', () => {
  const at = (url, html, status = 200) => P.blockedReason({ status, url, doc: html ? parseHtml(html) : null });

  it('stops at a sign-in form, a CAPTCHA, or a bot check', () => {
    expect(at('https://www.amazon.com/cpe/yourpayments/transactions', SIGN_IN)).toBe('sign-in');
    expect(at('https://www.amazon.com/your-orders/orders', CAPTCHA)).toBe('sign-in');
    expect(at('https://www.amazon.com/your-orders/orders', WAF)).toBe('sign-in');
  });

  it('stops when Amazon redirected to sign-in', () => {
    expect(at('https://www.amazon.com/ap/signin?openid.return_to=x', '<html></html>')).toBe('sign-in');
    expect(at('https://www.amazon.com/x', null, 403)).toBe('sign-in');
  });

  it("reports Amazon's error page and error statuses as unavailable", () => {
    expect(at('https://www.amazon.com/your-orders/orders', SORRY)).toBe('unavailable');
    expect(at('https://www.amazon.com/x', null, 503)).toBe('unavailable');
    expect(at('https://www.amazon.com/x', null, 429)).toBe('unavailable');
  });

  it('lets the pages it reads through', () => {
    for (const name of ['payments-data.html', 'payments-form.html', 'orders-2026.html', 'order-details-digital.html']) {
      expect(at('https://www.amazon.com/x', fixture(name))).toBeNull();
    }
  });
});

describe('parseTransactionsPage', () => {
  it('reads the current page, whose data rides in a script', () => {
    const page = P.parseTransactionsPage(parseHtml(fixture('payments-data.html')));
    expect(page.transactions).toEqual([
      { date: '2026-11-08', amount: -19.99, orderNumber: '111-0000000-0000001', seller: 'AMZN Mktp US' },
      { date: '2026-11-06', amount: 16.23, orderNumber: '111-0000000-0000002', seller: 'AMZN Mktp US' },
      // A digital order's descriptor is its order number: not a seller.
      { date: '2026-10-30', amount: -7.46, orderNumber: 'D01-0000000-0000003', seller: '' },
    ]);
    expect(page.next).toEqual({
      kind: 'data',
      exclusiveStartKey: 'page-key-1',
      token: 'upx-token-1',
      locale: 'en_US',
      widgetName: 'ViewTransactions',
    });
  });

  it('reads a further page from the JSON endpoint', () => {
    const previous = { kind: 'data', exclusiveStartKey: 'page-key-1', token: 't', locale: 'en_US', widgetName: 'W' };
    const page = P.parseTransactionDataPage(JSON.parse(fixture('payments-data-page-2.json')), previous);
    expect(page.transactions[0]).toEqual({
      date: '2026-09-02',
      amount: -1204.5,
      orderNumber: '111-0000000-0000004',
      seller: 'Amazon.com',
    });
    expect(page.next).toEqual({ ...previous, exclusiveStartKey: 'page-key-2' });
  });

  it('reads the older server-rendered page and its next-page form', () => {
    const page = P.parseTransactionsPage(parseHtml(fixture('payments-form.html')));
    expect(page.transactions).toEqual([
      { date: '2026-11-05', amount: -45.19, orderNumber: '111-0000000-0000005', seller: 'Prime Video Channels' },
      { date: '2026-10-30', amount: 8, orderNumber: '111-0000000-0000006', seller: 'AMZN Mktp US' },
    ]);
    expect(page.next).toEqual({
      kind: 'form',
      fields: {
        'ppw-widgetState': 'widget-state-1',
        ie: 'UTF-8',
        'ppw-widgetEvent:DefaultNextPageNavigationEvent:{"nextPageKey":"k2"}': '',
      },
    });
  });

  it('reads an empty history as no payments', () => {
    const html = `<html><body><div class="pmts-portal-component">You don't have any transactions.</div></body></html>`;
    expect(P.parseTransactionsPage(parseHtml(html))).toEqual({ transactions: [], next: null });
  });

  it('returns null for a page it does not know', () => {
    expect(P.parseTransactionsPage(parseHtml('<html><body><h1>Hello</h1></body></html>'))).toBeNull();
    expect(P.parseTransactionsPage(parseHtml('<script id="__NEXT_DATA__">{not json</script>'))).toBeNull();
  });

  const dataPage = (transactionList, extra = {}) =>
    parseHtml(
      `<script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            state: { transactionResponseState: { visibleTransactionResponse: { transactionList }, ...extra } },
            token: 't',
          },
        },
      })}</script>`,
    );

  it('returns null for rows of which none reads, rather than "no purchases"', () => {
    // An account set to Spanish: the dates are not ones this reads.
    const spanish = [{ formattedAmount: '-$5.00', formattedDate: '16 mar 2026', orderData: [] }];
    expect(P.parseTransactionsPage(dataPage(spanish))).toBeNull();
    expect(P.parseTransactionDataPage({ displayResponse: { transactionsList: spanish } }, {})).toBeNull();
    const form = fixture('payments-form.html').replaceAll('November 5, 2026', '5 nov 2026').replaceAll('October 30, 2026', '30 oct 2026');
    expect(P.parseTransactionsPage(parseHtml(form))).toBeNull();
  });

  it('marks more pages it cannot ask for, instead of ending quietly', () => {
    const row = [{ formattedAmount: '-$5.00', formattedDate: 'Mar 16, 2026', orderData: [] }];
    expect(P.parseTransactionsPage(dataPage(row, { hasMore: true })).next).toEqual({ kind: 'missing' });
  });

  it('keeps a seller name, but never a card, an order number or invisible characters', () => {
    const rows = [
      ['Prime Video Channels', 'Prime Video Channels'],
      ['Kindle\u200b Svcs\u202e', 'Kindle Svcs'],
      ['Visa ****1234', ''],
      ['•••• 1234', ''],
      ['Card ending in 1234', ''],
      ['Mastercard', ''],
      ['D01-0000000-0000003', ''],
      ['12345', ''],
      ['x'.repeat(61), ''],
    ].map(([statementDescriptor, expected]) => ({ statementDescriptor, expected }));
    const page = P.parseTransactionsPage(
      dataPage(rows.map((r) => ({ formattedAmount: '-$1.00', formattedDate: 'Mar 1, 2026', statementDescriptor: r.statementDescriptor }))),
    );
    expect(page.transactions.map((t) => t.seller)).toEqual(rows.map((r) => r.expected));
  });
});

describe('parseOrderHistoryPage', () => {
  const page = P.parseOrderHistoryPage(parseHtml(fixture('orders-2026.html')));

  it('reads each order card: number, date placed and products', () => {
    expect(page.orders).toHaveLength(3);
    expect(page.orders[0]).toEqual({
      orderNumber: '111-0000000-0000001',
      placedDate: '2026-11-07',
      items: [{ title: 'Dry Erase Markers, Fine Tip, 12 Count', quantity: 2 }],
      encrypted: false,
    });
  });

  it('reads products across layouts, once each, falling back to image text', () => {
    expect(page.orders[1].items).toEqual([
      { title: 'Slime Kit for Kids, 24 Pack Mini Slime Party Favors', quantity: 1 },
      { title: 'Flower Party Balloons', quantity: 3 },
    ]);
  });

  it('strips control and invisible characters from product names', () => {
    const html = `<div class="order-card"><span dir="ltr">111-0000000-0000008</span>
      <a href="/dp/B000000008">Zero\u200bWidth \u202eBidi\u0007 Title</a></div>`;
    expect(P.parseOrderHistoryPage(parseHtml(html)).orders[0].items).toEqual([{ title: 'ZeroWidth Bidi Title', quantity: 1 }]);
  });

  it('lists no products for a store purchase', () => {
    expect(page.orders[2]).toMatchObject({ orderNumber: '111-0000000-0000007', items: [] });
  });

  it('follows the next-page link on the same site only', () => {
    expect(page.nextPath).toBe(
      '/your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2',
    );
    expect(P.sameSitePath('https://evil.example/your-orders/orders')).toBeNull();
    expect(P.sameSitePath('//evil.example/x')).toBeNull();
  });

  it('flags a card served encrypted, with no next page', () => {
    const encrypted = P.parseOrderHistoryPage(parseHtml(fixture('orders-encrypted.html')));
    expect(encrypted.orders).toEqual([{ orderNumber: null, placedDate: null, items: [], encrypted: true }]);
    expect(encrypted.nextPath).toBeNull();
  });
});

describe('parseOrderDetailsPage', () => {
  it("reads the order's own products, not the page's recommendations", () => {
    const details = P.parseOrderDetailsPage(parseHtml(fixture('order-details-digital.html')));
    expect(details).toEqual({ items: [{ title: 'The Example Novel (Kindle Edition)', quantity: 1 }] });
  });

  it('returns null for a page that is not an order', () => {
    expect(P.parseOrderDetailsPage(parseHtml('<html><body></body></html>'))).toBeNull();
  });
});
