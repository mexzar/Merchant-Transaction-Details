import { describe, expect, it } from 'vitest';
import { MTD, fixture, parseHtml } from './load.js';
import { SIGN_IN } from './fixtures/blocked.js';

const { readAmazon, ReadError } = MTD.amazonRead;

const PAYMENTS = 'GET /cpe/yourpayments/transactions';
const PAYMENTS_DATA = 'POST /payments-portal/data/iris/live/v1/data/manage/get-transactions';
const ORDERS_2026 = 'GET /your-orders/orders?timeFilter=year-2026';
const ORDERS_2026_PAGE_2 = 'GET /your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2';
const EMPTY = '<html><body></body></html>';

/** A stand-in for the tab's fetch: answers from `pages`, records every request. */
function fakeAmazon(pages) {
  const requests = [];
  return {
    requests,
    http: {
      async request(req) {
        const key = `${req.method || 'GET'} ${req.path}`;
        requests.push({ key, ...req });
        const page = pages[key];
        if (page === undefined) throw new Error(`unexpected request ${key}`);
        if (page instanceof Error) throw page;
        const res = typeof page === 'string' ? { text: page } : page;
        return { status: 200, url: `https://www.amazon.com${req.path}`, ...res };
      },
    },
  };
}

function read(amazon, options = {}) {
  const sleeps = [];
  const run = readAmazon({
    http: amazon.http,
    parseHtml,
    today: '2026-11-10',
    days: 91,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...options,
  });
  return { run, sleeps };
}

const HAPPY = {
  [PAYMENTS]: fixture('payments-data.html'),
  [PAYMENTS_DATA]: fixture('payments-data-page-2.json'),
  [ORDERS_2026]: fixture('orders-2026.html'),
  [ORDERS_2026_PAGE_2]: EMPTY,
  'GET /gp/your-account/order-details?orderID=111-0000000-0000002': EMPTY,
  'GET /gp/your-account/order-details?orderID=D01-0000000-0000003': fixture('order-details-digital.html'),
};

describe('readAmazon', () => {
  it('reads the payments in range, then finds what each order contained', async () => {
    const amazon = fakeAmazon(HAPPY);
    const progress = [];
    const { run, sleeps } = read(amazon, { onProgress: (p) => progress.push(p) });
    const result = await run;

    expect(result.transactions.map((t) => [t.date, t.amount, t.orderNumber])).toEqual([
      ['2026-11-08', -19.99, '111-0000000-0000001'],
      ['2026-11-06', 16.23, '111-0000000-0000002'],
      ['2026-10-30', -7.46, 'D01-0000000-0000003'],
      ['2026-09-02', -1204.5, '111-0000000-0000004'],
    ]);
    expect(Object.fromEntries(result.orders)).toEqual({
      '111-0000000-0000001': { items: [{ title: 'Dry Erase Markers, Fine Tip, 12 Count', quantity: 2 }] },
      '111-0000000-0000004': {
        items: [
          { title: 'Slime Kit for Kids, 24 Pack Mini Slime Party Favors', quantity: 1 },
          { title: 'Flower Party Balloons', quantity: 3 },
        ],
      },
      'D01-0000000-0000003': { items: [{ title: 'The Example Novel (Kindle Edition)', quantity: 1 }] },
    });
    expect(result.stats).toEqual({
      payments: 4,
      paymentsCut: false,
      ordersNeeded: 4,
      ordersFound: 3,
      stopped: null,
    });
    expect(amazon.requests.map((r) => r.key)).toEqual([
      PAYMENTS,
      PAYMENTS_DATA,
      ORDERS_2026,
      ORDERS_2026_PAGE_2,
      'GET /gp/your-account/order-details?orderID=111-0000000-0000002',
      'GET /gp/your-account/order-details?orderID=D01-0000000-0000003',
    ]);
    // One request at a time, with a pause before every one after the first.
    expect(sleeps).toEqual([1000, 1000, 1000, 1000, 1000]);
    expect(progress[0]).toEqual({ stage: 'payments', count: 0 });
    expect(progress.at(-1)).toEqual({ stage: 'details', count: 3, of: 4 });
  });

  it('asks the JSON endpoint for further payments the way the page does', async () => {
    const amazon = fakeAmazon(HAPPY);
    await read(amazon).run;
    const dataRequest = amazon.requests[1];
    expect(dataRequest.json).toEqual({
      type: 'GetTransactions',
      locale: 'en_US',
      exclusiveStartKey: 'page-key-1',
      widgetName: 'ViewTransactions',
    });
    expect(dataRequest.headers).toEqual({ Accept: 'application/json', 'x-amzn-upx-token': 'upx-token-1' });
    expect(dataRequest.referrerPath).toBe('/cpe/yourpayments/transactions');
  });

  it('posts the next-page form on the older payments page', async () => {
    const amazon = fakeAmazon({
      [PAYMENTS]: fixture('payments-form.html'),
      'POST /cpe/yourpayments/transactions': `<html><body><div class="pmts-portal-component">You don't have any transactions.</div></body></html>`,
      [ORDERS_2026]: EMPTY,
      'GET /your-orders/orders?timeFilter=year-2025': EMPTY,
      'GET /gp/your-account/order-details?orderID=111-0000000-0000005': EMPTY,
      'GET /gp/your-account/order-details?orderID=111-0000000-0000006': EMPTY,
    });
    const result = await read(amazon, { pauseMs: 0, today: '2026-11-10', days: 365 }).run;
    expect(result.transactions).toHaveLength(2);
    expect(amazon.requests[1].form).toMatchObject({ 'ppw-widgetState': 'widget-state-1', ie: 'UTF-8' });
    // A range reaching back into 2025 also looks at 2025's orders.
    expect(amazon.requests.map((r) => r.key)).toContain('GET /your-orders/orders?timeFilter=year-2025');
  });

  it('stops before any order request once every order is found', async () => {
    const amazon = fakeAmazon({
      [PAYMENTS]: `<html><body><script id="__NEXT_DATA__">${JSON.stringify({
        props: {
          pageProps: {
            state: {
              transactionResponseState: {
                visibleTransactionResponse: {
                  transactionList: [{ formattedAmount: '-$1.00', formattedDate: 'Nov 9, 2026', orderData: [] }],
                },
              },
            },
          },
        },
      })}</script></body></html>`,
    });
    const result = await read(amazon).run;
    expect(result.transactions).toHaveLength(1);
    expect(amazon.requests).toHaveLength(1);
  });

  it('fails the read when Amazon asks for sign-in on the payments page', async () => {
    const amazon = fakeAmazon({ [PAYMENTS]: SIGN_IN });
    await expect(read(amazon).run).rejects.toMatchObject({ code: 'sign-in' });
  });

  it('keeps the payments, and stops asking, when Amazon asks for sign-in on the orders', async () => {
    const amazon = fakeAmazon({ ...HAPPY, [ORDERS_2026]: SIGN_IN });
    const result = await read(amazon).run;
    expect(result.transactions).toHaveLength(4);
    expect(result.stats).toMatchObject({ ordersFound: 0, stopped: 'sign-in' });
    expect(amazon.requests.at(-1).key).toBe(ORDERS_2026);
  });

  it("asks for Amazon's no-script page when the order cards come encrypted", async () => {
    const amazon = fakeAmazon({
      ...HAPPY,
      [ORDERS_2026]: fixture('orders-encrypted.html'),
      'GET /your-orders/orders?timeFilter=year-2026&disableCsd=no-js': fixture('orders-2026.html'),
    });
    const result = await read(amazon).run;
    expect(result.orders.has('111-0000000-0000001')).toBe(true);
    // The next page drops the no-script flag; it carries over only if needed again.
    expect(amazon.requests.map((r) => r.key)).toContain(ORDERS_2026_PAGE_2);
  });

  it('reads a bounded number of pages', async () => {
    const amazon = fakeAmazon(HAPPY);
    const result = await read(amazon, {
      limits: { paymentPages: 1, orderPages: 1, orderDetails: 1 },
    }).run;
    expect(result.stats.paymentsCut).toBe(true);
    expect(result.transactions).toHaveLength(3);
    expect(amazon.requests.map((r) => r.key)).toEqual([
      PAYMENTS,
      ORDERS_2026,
      'GET /gp/your-account/order-details?orderID=111-0000000-0000002',
    ]);
  });

  it('stops at the next request once cancelled', async () => {
    let cancelled = false;
    const amazon = fakeAmazon(HAPPY);
    const { run } = read(amazon, {
      onProgress: (p) => {
        if (p.count > 0) cancelled = true;
      },
      isCancelled: () => cancelled,
    });
    await expect(run).rejects.toBeInstanceOf(ReadError);
    await expect(run).rejects.toMatchObject({ code: 'cancelled' });
    expect(amazon.requests).toHaveLength(1);
  });

  it('says the read was cut short when Amazon offers more pages without a way to ask', async () => {
    const page = fixture('payments-data.html').replace('"lastEvaluatedPageKey": "page-key-1"', '"lastEvaluatedPageKey": null');
    const amazon = fakeAmazon({ ...HAPPY, [PAYMENTS]: page });
    const result = await read(amazon).run;
    expect(result.stats.paymentsCut).toBe(true);
    expect(amazon.requests.map((r) => r.key)).not.toContain(PAYMENTS_DATA);
  });

  it('fails the read on a payments page whose rows none read, without paging on', async () => {
    const page = fixture('payments-data.html').replace(/"formattedDate": "[^"]*"/g, '"formattedDate": "8 nov 2026"');
    const amazon = fakeAmazon({ ...HAPPY, [PAYMENTS]: page });
    await expect(read(amazon).run).rejects.toMatchObject({ code: 'layout' });
    expect(amazon.requests).toHaveLength(1);
  });

  it('keeps the payments when an order page throws something unexpected', async () => {
    const amazon = fakeAmazon(HAPPY);
    const brokenParse = (html) => {
      if (html === HAPPY[ORDERS_2026]) throw new TypeError('boom');
      return parseHtml(html);
    };
    const result = await read(amazon, { parseHtml: brokenParse }).run;
    expect(result.transactions).toHaveLength(4);
    expect(result.stats.stopped).toBe('layout');
  });

  it('counts only orders with product names as found', async () => {
    // The store purchase (111-…7) is found but has no products.
    const page = fixture('payments-data.html').replace('111-0000000-0000001', '111-0000000-0000007');
    const result = await read(fakeAmazon({ ...HAPPY, [PAYMENTS]: page })).run;
    expect(result.orders.get('111-0000000-0000007')).toEqual({ items: [] });
    expect(result.stats).toMatchObject({ ordersNeeded: 4, ordersFound: 2 });
  });

  it('reports a dropped connection as a network failure', async () => {
    const amazon = fakeAmazon({ [PAYMENTS]: new TypeError('Failed to fetch') });
    await expect(read(amazon).run).rejects.toMatchObject({ code: 'network' });
  });

  it('reports a page it cannot read as a layout failure', async () => {
    const amazon = fakeAmazon({ [PAYMENTS]: '<html><body>Hello</body></html>' });
    await expect(read(amazon).run).rejects.toMatchObject({ code: 'layout' });
  });

  it('reports an error status as unavailable', async () => {
    const amazon = fakeAmazon({ [PAYMENTS]: { status: 503, text: EMPTY } });
    await expect(read(amazon).run).rejects.toMatchObject({ code: 'unavailable' });
  });
});
