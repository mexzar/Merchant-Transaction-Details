/*
 * One read of the user's Amazon history, page by page, as the signed-in user
 * in their own tab:
 *
 *   1. Your Payments, newest first, until the range starts. These are the
 *      charges and refunds a bank statement shows.
 *   2. Your Orders, a year at a time, until every order those payments name
 *      is found (or the orders are older than any payment could be).
 *   3. The details page of each order still missing (digital orders are not
 *      in Your Orders), up to a limit.
 *
 * Requests go one at a time with a pause between them. Anything that is not
 * the page asked for (a sign-in form, a CAPTCHA, a bot check) stops the read:
 * the extension never answers one, the user does.
 *
 * Network access is through the `http` passed in, so this runs against
 * saved pages in tests.
 */
(function (root) {
  'use strict';
  const MTD = (root.MTD = root.MTD || {});
  const P = MTD.amazonParse;

  const PAYMENTS_PATH = '/cpe/yourpayments/transactions';
  const PAYMENTS_DATA_PATH = '/payments-portal/data/iris/live/v1/data/manage/get-transactions';
  const ORDERS_PATH = '/your-orders/orders';
  const ORDER_DETAILS_PATH = '/gp/your-account/order-details';

  // At most this many requests of each kind in one read, so a long history,
  // or a page that keeps offering "next", stays a bounded number of requests.
  const LIMITS = { paymentPages: 60, orderPages: 80, orderDetails: 25 };
  // An order is charged when it ships, so one placed up to this long before
  // the range can still have a charge inside it.
  const ORDER_LOOKBACK_DAYS = 90;

  class ReadError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }

  function addDays(day, n) {
    const d = new Date(`${day}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function withParam(path, key, value) {
    const url = new URL(path, 'https://www.amazon.com');
    url.searchParams.set(key, value);
    return url.pathname + url.search;
  }

  function withoutParam(path, key) {
    const url = new URL(path, 'https://www.amazon.com');
    url.searchParams.delete(key);
    return url.pathname + url.search;
  }

  /**
   * Read the payments in `days` days up to `today` ("YYYY-MM-DD", the user's
   * calendar) and what their orders contained.
   *
   * Returns `{ transactions, orders, stats }`: `transactions` newest first as
   * `{ date, amount, orderNumber, seller }`, `orders` a Map from order number
   * to `{ items }`, and `stats` counts plus `stopped`, the reason the order
   * steps stopped early (the payments are complete either way).
   *
   * Throws a ReadError when the payments cannot be read: `sign-in`,
   * `unavailable`, `layout` (not a page this reads), `network` or `cancelled`.
   */
  async function readAmazon({
    http,
    parseHtml,
    today,
    days,
    pauseMs = 1000,
    sleep,
    onProgress = () => {},
    isCancelled = () => false,
    limits = LIMITS,
  }) {
    const fromDay = addDays(today, -days);
    let requests = 0;

    async function send(request) {
      if (isCancelled()) throw new ReadError('cancelled');
      if (requests++ > 0 && pauseMs > 0) await sleep(pauseMs);
      if (isCancelled()) throw new ReadError('cancelled');
      try {
        return await http.request(request);
      } catch (_) {
        throw new ReadError('network');
      }
    }

    function check(res, doc) {
      const blocked = P.blockedReason({ status: res.status, url: res.url, doc });
      if (blocked) throw new ReadError(blocked);
      if (res.status < 200 || res.status >= 300) throw new ReadError('unavailable');
    }

    async function getPage(path, init = {}) {
      const res = await send({ path, ...init });
      const doc = parseHtml(res.text);
      check(res, doc);
      return doc;
    }

    async function getJson(request) {
      const res = await send(request);
      let json;
      try {
        json = JSON.parse(res.text);
      } catch (_) {
        check(res, parseHtml(res.text));
        throw new ReadError('layout');
      }
      check(res, null);
      return json;
    }

    async function nextPaymentsPage(next) {
      if (next.kind === 'form') {
        return P.parseTransactionsPage(await getPage(PAYMENTS_PATH, { method: 'POST', form: next.fields }));
      }
      const json = await getJson({
        path: PAYMENTS_DATA_PATH,
        method: 'POST',
        json: {
          type: 'GetTransactions',
          locale: next.locale,
          exclusiveStartKey: next.exclusiveStartKey,
          widgetName: next.widgetName,
        },
        headers: { Accept: 'application/json', 'x-amzn-upx-token': next.token },
        referrerPath: PAYMENTS_PATH,
      });
      return P.parseTransactionDataPage(json, next);
    }

    // 1. Payments.
    onProgress({ stage: 'payments', count: 0 });
    let page = P.parseTransactionsPage(await getPage(PAYMENTS_PATH));
    if (!page) throw new ReadError('layout');
    const transactions = [];
    let paymentPages = 1;
    let paymentsCut = false;
    for (;;) {
      let reachedStart = false;
      for (const t of page.transactions) {
        if (t.date >= fromDay && t.date <= today) transactions.push(t);
        else if (t.date < fromDay) reachedStart = true;
      }
      onProgress({ stage: 'payments', count: transactions.length });
      if (reachedStart || !page.next) break;
      if (page.next.kind === 'missing' || paymentPages >= limits.paymentPages) {
        paymentsCut = true;
        break;
      }
      paymentPages++;
      page = await nextPaymentsPage(page.next);
      if (!page) throw new ReadError('layout');
    }

    // 2 and 3. Orders. A stop here, for any reason but Stop, keeps the
    // payments and what was found.
    const needed = new Set(transactions.map((t) => t.orderNumber).filter(Boolean));
    const orders = new Map();
    let stopped = null;
    try {
      await findInOrderHistory();
      await findInOrderDetails();
    } catch (e) {
      if (e instanceof ReadError && e.code === 'cancelled') throw e;
      stopped = (e instanceof ReadError && e.code) || 'layout';
    }

    async function findInOrderHistory() {
      const oldest = addDays(fromDay, -ORDER_LOOKBACK_DAYS);
      let pages = 0;
      for (let year = Number(today.slice(0, 4)); year >= Number(oldest.slice(0, 4)); year--) {
        let path = `${ORDERS_PATH}?timeFilter=year-${year}`;
        while (path) {
          if (orders.size >= needed.size) return;
          if (pages >= limits.orderPages) return;
          pages++;
          let parsed = P.parseOrderHistoryPage(await getPage(path));
          if (parsed.orders.some((o) => o.encrypted) && pages < limits.orderPages) {
            pages++;
            const plain = P.parseOrderHistoryPage(await getPage(withParam(path, 'disableCsd', 'no-js')));
            if (plain.orders.length) parsed = plain;
          }
          for (const o of parsed.orders) {
            if (o.orderNumber && !o.encrypted && needed.has(o.orderNumber) && !orders.has(o.orderNumber)) {
              orders.set(o.orderNumber, { items: o.items });
            }
          }
          onProgress({ stage: 'orders', count: orders.size, of: needed.size });
          if (!parsed.orders.length) break;
          // Newest first: once a page ends before `oldest`, so does every
          // later page and every earlier year.
          const last = parsed.orders[parsed.orders.length - 1].placedDate;
          if (last && last < oldest) return;
          const nextPath = parsed.nextPath;
          path = nextPath && nextPath.startsWith(`${ORDERS_PATH}?`) ? withoutParam(nextPath, 'disableCsd') : null;
        }
      }
    }

    // Orders found with product names. A store purchase is found but has
    // none, and its details page has none either, so it is not looked up.
    function withProducts() {
      return Array.from(orders.values()).filter((o) => o.items.length).length;
    }

    async function findInOrderDetails() {
      const missing = Array.from(needed).filter((n) => !orders.has(n));
      for (const orderNumber of missing.slice(0, limits.orderDetails)) {
        const doc = await getPage(`${ORDER_DETAILS_PATH}?orderID=${encodeURIComponent(orderNumber)}`);
        const parsed = P.parseOrderDetailsPage(doc);
        if (parsed && parsed.items.length) orders.set(orderNumber, parsed);
        onProgress({ stage: 'details', count: withProducts(), of: needed.size });
      }
    }

    return {
      transactions,
      orders,
      stats: {
        payments: transactions.length,
        paymentsCut,
        ordersNeeded: needed.size,
        ordersFound: withProducts(),
        stopped,
      },
    };
  }

  MTD.amazonRead = { readAmazon, ReadError, addDays, LIMITS };
})(globalThis);
