/*
 * Reads the Amazon pages the extension fetches: Your Payments (charges and
 * refunds), Your Orders (what each order contained) and an order's details.
 * The page shapes follow the open-source amazon-orders library
 * (github.com/alexdlaird/amazon-orders, MIT), which the desktop app uses.
 *
 * Pure: every function takes an already-parsed Document or JSON value. No
 * network, no clock.
 */
(function (root) {
  'use strict';
  const MTD = (root.MTD = root.MTD || {});

  // 111-1234567-1234567, D01-1234567-1234567 (digital), and the two other
  // shapes Amazon uses, as amazon-orders reads them.
  const ORDER_NUMBER =
    /(?<![A-Z0-9-])(?:[A-Z0-9]{3}-\d{7}-\d{7}|\d{4}-\d{6}-\d{7}|\d{19})(?![A-Z0-9-])/;
  const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const DATE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i;
  const ASIN_IN_HREF = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?=[/?#]|$)/;

  function text(el) {
    return el ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  /** Text with a space between elements, so "Order placed" and its date stay apart. */
  function spacedText(el) {
    const SHOW_TEXT = 4;
    const walker = el.ownerDocument.createTreeWalker(el, SHOW_TEXT);
    const parts = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }

  /**
   * Text sellers and Amazon wrote, on one line, without control or invisible
   * formatting characters (zero-width, bidi controls), which have no place in
   * a note.
   */
  function clean(value) {
    return String(value)
      .replace(/[\p{Cf}\u2028\u2029]/gu, '')
      .replace(/[\p{Cc}\s]+/gu, ' ')
      .trim();
  }

  /** "Mar 16, 2026" or "November 5, 2026" (the first in the text) → "2026-03-16". */
  function parseDate(value) {
    const m = DATE.exec(value || '');
    if (!m) return null;
    const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
    const day = Number(m[2]);
    const year = Number(m[3]);
    const check = new Date(Date.UTC(year, month - 1, day));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) {
      return null;
    }
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  /** "-$45.68" → -45.68, "+$52.62" → 52.62, "($1.99)" → -1.99. */
  function parseAmount(value) {
    if (typeof value !== 'string') return null;
    let v = value.trim();
    let negative = false;
    if (v.startsWith('(') && v.endsWith(')')) {
      negative = true;
      v = v.slice(1, -1);
    }
    if (/[-−]/.test(v)) negative = true;
    const m = /(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/.exec(v);
    if (!m) return null;
    const cents = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '0').padEnd(2, '0'));
    if (!Number.isSafeInteger(cents)) return null;
    return (negative ? -cents : cents) / 100;
  }

  function orderNumberIn(value) {
    const m = ORDER_NUMBER.exec(value || '');
    return m ? m[0] : null;
  }

  // ---------------------------------------------------------------------------
  // Pages Amazon shows instead of the one asked for

  /**
   * Why a fetched page is not the page asked for, or null when it is.
   * `sign-in`: a sign-in form, a CAPTCHA, or a bot or "is it you" check. The
   * extension never answers one; the user does, in the tab. `unavailable`:
   * Amazon's error page or an error status.
   */
  function blockedReason({ status, url, doc }) {
    let path = '';
    try {
      path = new URL(url).pathname;
    } catch (_) {
      path = '';
    }
    if (status === 401 || status === 403) return 'sign-in';
    if (/^\/(ap|ax)\//.test(path) || /validateCaptcha|\/errors\//.test(path)) return 'sign-in';
    if (doc) {
      if (
        doc.querySelector(
          "form[name='signIn'], form[action*='/ap/'], form[action*='/ax/'], form[action*='validateCaptcha'], " +
            "input[id^='captchacharacters'], #captcha-container, form.cvf-widget-form, form#auth-mfa-form, " +
            'form#auth-select-device-form, form#intent-confirmation-form, form#verification-code-form',
        )
      ) {
        return 'sign-in';
      }
      const scripts = Array.from(doc.querySelectorAll('script'))
        .map((s) => s.textContent)
        .join('\n');
      if (/AwsWafIntegration|awsWafCookieDomainList|bm-verify|acic-(?:setup|component)/.test(scripts)) {
        return 'sign-in';
      }
      const title = text(doc.querySelector('title'));
      if (title === 'Challenge Page') return 'sign-in';
      if (/^Sorry! Something went wrong/i.test(title)) return 'unavailable';
    }
    if (status === 429 || status >= 500) return 'unavailable';
    return null;
  }

  // ---------------------------------------------------------------------------
  // Your Payments: /cpe/yourpayments/transactions

  /**
   * A Your Payments page: `{ transactions, next }`, or null when it is not
   * one this reads. Amazon serves it two ways: a page whose data rides in a
   * `__NEXT_DATA__` script (further pages come from a JSON endpoint), and an
   * older server-rendered form (further pages are a form post).
   */
  function parseTransactionsPage(doc) {
    const stateInput = doc.querySelector("input[name='ppw-widgetState']");
    const form = stateInput && stateInput.closest('form');
    if (form) return parseTransactionForm(form);

    const data = doc.querySelector('script#__NEXT_DATA__');
    if (data) return parseTransactionData(data.textContent);

    const container = doc.querySelector('.pmts-portal-component');
    if (container && /don.t have any transactions/i.test(container.textContent)) {
      return { transactions: [], next: null };
    }
    return null;
  }

  function parseTransactionData(json) {
    let props;
    try {
      props = JSON.parse(json).props.pageProps;
    } catch (_) {
      return null;
    }
    const state = props && props.state && props.state.transactionResponseState;
    const visible = state && state.visibleTransactionResponse;
    const list = visible && visible.transactionList;
    if (!Array.isArray(list)) return null;

    let next = null;
    if (state.hasMore) {
      const request = props.request || {};
      // More pages, but nothing to ask for them with: say the read was cut
      // short rather than end it quietly.
      next =
        state.lastEvaluatedPageKey && props.token
          ? {
              kind: 'data',
              exclusiveStartKey: state.lastEvaluatedPageKey,
              token: String(props.token),
              locale: request.locale || 'en_US',
              widgetName: request.widgetName || 'ViewTransactions',
            }
          : { kind: 'missing' };
    }
    const transactions = readTransactionList(list);
    if (list.length && !transactions.length) return null;
    return { transactions, next };
  }

  /** A further page from the JSON endpoint, read against the `next` that asked for it. */
  function parseTransactionDataPage(json, previous) {
    const display = json && json.displayResponse;
    const list = display && display.transactionsList;
    if (!Array.isArray(list)) return null;
    const transactions = readTransactionList(list);
    if (list.length && !transactions.length) return null;
    const lastKey = display.lastEvaluatedKey;
    const next = lastKey && list.length ? { ...previous, exclusiveStartKey: lastKey } : null;
    return { transactions, next };
  }

  // A page with rows of which none reads (an account in another language, a
  // changed date format) is returned as null, "not a page this reads",
  // rather than as an empty page: that would read as "no purchases" and keep
  // paging.

  function readTransactionList(list) {
    const out = [];
    for (const t of list) {
      if (!t || typeof t !== 'object') continue;
      const date = parseDate(t.formattedDate);
      const amount = parseAmount(t.formattedAmount);
      if (!date || amount === null) continue;
      const order = (Array.isArray(t.orderData) && t.orderData[0]) || {};
      const orderNumber = orderNumberIn(String(order.orderDisplayString || ''));
      const seller = typeof t.statementDescriptor === 'string' ? t.statementDescriptor : '';
      out.push({ date, amount, orderNumber, seller: sellerName(seller) });
    }
    return out;
  }

  function parseTransactionForm(form) {
    const transactions = [];
    let rows = 0;
    for (const dateBox of form.querySelectorAll('div.apx-transaction-date-container')) {
      rows++;
      const date = parseDate(text(dateBox.querySelector('span')));
      if (!date) continue;
      let group = dateBox.nextElementSibling;
      while (group && group.tagName !== 'DIV') group = group.nextElementSibling;
      if (!group) continue;
      for (const line of group.querySelectorAll('div.apx-transactions-line-item-component-container')) {
        const first = line.firstElementChild;
        if (!first) continue;
        rows++;
        const amount = parseAmount(text(first.querySelector('span.a-size-base-plus')));
        if (amount === null) continue;
        let orderNumber = null;
        for (const cell of line.querySelectorAll('.a-span12')) {
          orderNumber = orderNumberIn(cell.textContent);
          if (orderNumber) break;
        }
        transactions.push({ date, amount, orderNumber, seller: sellerName(sellerAfterOrderLink(line)) });
      }
    }
    if (rows && !transactions.length) return null;

    const state = form.querySelector("input[name='ppw-widgetState']");
    const ie = form.querySelector("input[name='ie']");
    const nextButton = form.querySelector(
      "input[type='submit'][name^='ppw-widgetEvent:DefaultNextPageNavigationEvent']",
    );
    const next =
      state && ie && nextButton
        ? { kind: 'form', fields: { 'ppw-widgetState': state.value, ie: ie.value, [nextButton.name]: '' } }
        : null;
    return { transactions, next };
  }

  // A payment card: "Visa ****1234", "•••• 1234", "ending in 1234".
  const CARD_LIKE =
    /(?:[*•·xX]{2,}|ending in)\s*\d{2,4}|\b(?:visa|master ?card|amex|american express|discover|debit card|credit card)\b/i;

  /**
   * The name Amazon shows for a charge ("Prime Video Channels"), or '' for
   * anything that is not one: an order number, something that looks like a
   * payment card (the older page finds this line by position, so a changed
   * layout must never turn a card into a note), or text too long to be a
   * statement name.
   */
  function sellerName(value) {
    const v = clean(value || '');
    if (!v || v.length > 60 || !/\p{L}/u.test(v) || orderNumberIn(v) || CARD_LIKE.test(v)) return '';
    return v;
  }

  /** The seller line is the block right after the one holding the order link. */
  function sellerAfterOrderLink(line) {
    const link = line.querySelector('a.a-link-normal');
    for (let el = link; el && el !== line; el = el.parentElement) {
      const next = el.nextElementSibling;
      if (next && next.tagName === 'DIV') return text(next);
    }
    return '';
  }

  // ---------------------------------------------------------------------------
  // Your Orders: /your-orders/orders?timeFilter=year-YYYY

  /** `{ orders: [{ orderNumber, placedDate, items, encrypted }], nextPath }`. */
  function parseOrderHistoryPage(doc) {
    let cards = Array.from(doc.querySelectorAll('div.order-card'));
    if (!cards.length) cards = Array.from(doc.querySelectorAll('div.order'));
    cards = cards.filter((c) => !(c.parentElement && c.parentElement.closest('div.order-card, div.order')));

    const nextLink = doc.querySelector('ul.a-pagination li.a-last a');
    return {
      orders: cards.map(parseOrderCard),
      nextPath: nextLink ? sameSitePath(nextLink.getAttribute('href')) : null,
    };
  }

  const ORDER_NUMBER_SELECTORS = [
    "[data-component='orderId']",
    '.yohtmlc-order-id',
    "[data-component='briefOrderInfo']",
    '.order-date-invoice-item',
    'bdi[dir=ltr]',
    'span[dir=ltr]',
  ];

  function parseOrderCard(card) {
    let orderNumber = null;
    for (const selector of ORDER_NUMBER_SELECTORS) {
      for (const el of card.querySelectorAll(selector)) {
        orderNumber = orderNumberIn(el.textContent);
        if (orderNumber) break;
      }
      if (orderNumber) break;
    }
    // A card served encrypted (to be decrypted by Amazon's own script, which
    // never runs here) shows no readable order number. Amazon's no-script
    // version of the page shows it in the clear.
    const encrypted = !orderNumber && !!card.querySelector('div.csd-encrypted-sensitive');
    if (!orderNumber) orderNumber = orderNumberInLinks(card);

    const header = card.querySelector('.order-header') || card;
    return {
      orderNumber,
      placedDate: parseDate(spacedText(header)),
      items: encrypted || isStorePurchase(card) ? [] : productsIn([card]),
      encrypted,
    };
  }

  function orderNumberInLinks(scope) {
    for (const a of scope.querySelectorAll('a[href]')) {
      const m = /[?&]order[Ii][Dd]=([^&#]+)/.exec(a.getAttribute('href'));
      if (!m) continue;
      let value = m[1];
      try {
        value = decodeURIComponent(value);
      } catch (_) {
        // keep it as it is
      }
      const n = orderNumberIn(value);
      if (n) return n;
    }
    return null;
  }

  /**
   * Amazon Fresh, Whole Foods and in-store purchases: the history page does
   * not list their products in a form worth reading (amazon-orders skips
   * them too).
   */
  function isStorePurchase(card) {
    if (
      card.querySelector(
        ".brand-info-box .brand-logo img, a[href^='/wholefoodsmarket'], " +
          "a[href*='/wholefoodsmarket/receipts/order/'], a[href*='/fopo/order-details']",
      )
    ) {
      return true;
    }
    return Array.from(card.querySelectorAll('div.yohtmlc-shipment-status-primaryText')).some(
      (el) => text(el) === 'Purchased at Amazon',
    );
  }

  /**
   * The products linked inside `scopes`, once each, in page order: a title
   * (the link's own text, else its image's alt text) and a quantity (the
   * badge Amazon puts on the image, else 1). Reading product links rather
   * than one layout's boxes keeps working across the layouts Amazon mixes on
   * one page.
   */
  function productsIn(scopes) {
    const byAsin = new Map();
    for (const scope of scopes) {
      for (const a of scope.querySelectorAll('a[href]')) {
        const m = ASIN_IN_HREF.exec(a.getAttribute('href') || '');
        if (!m) continue;
        let product = byAsin.get(m[1]);
        if (!product) {
          product = { linkTitle: '', altTitle: '', quantity: 1, quantityRead: false };
          byAsin.set(m[1], product);
        }
        const own = clean(spacedText(a));
        if (own.length > product.linkTitle.length) product.linkTitle = own;
        const img = a.querySelector('img[alt]');
        const alt = img ? clean(img.getAttribute('alt')) : '';
        if (alt.length > product.altTitle.length) product.altTitle = alt;
        if (!product.quantityRead) {
          const qty = quantityNear(a);
          if (qty) {
            product.quantity = qty;
            product.quantityRead = true;
          }
        }
      }
    }
    const items = [];
    for (const p of byAsin.values()) {
      const title = p.linkTitle || p.altTitle;
      if (title) items.push({ title, quantity: p.quantity });
    }
    return items;
  }

  function quantityNear(link) {
    const box = link.closest(
      '.item-box, .yo-enhanced-flex-card, .yo-enhanced-card, .yohtmlc-item, .a-fixed-left-grid, .product-image',
    );
    const scope = box || link.parentElement;
    if (!scope) return null;
    const badge = scope.querySelector('.product-image__qty, .item-view-qty, .od-item-view-qty');
    const n = badge ? parseInt(text(badge).replace(/\D+/g, ''), 10) : NaN;
    return Number.isInteger(n) && n > 1 && n < 1000 ? n : null;
  }

  // ---------------------------------------------------------------------------
  // One order: /gp/your-account/order-details?orderID=…

  /**
   * The products of one order from its details page, or null when the page
   * is not one. Only the purchased-items and shipment blocks are read: the
   * rest of the page links to other products (recommendations, "buy it
   * again").
   */
  function parseOrderDetailsPage(doc) {
    const main = doc.querySelector('div#orderDetails, div#ordersContainer, div#odp-main-section');
    if (!main) return null;
    const scopes = Array.from(
      main.querySelectorAll("[data-component='purchasedItems'], div.shipment, div.a-box.shipment"),
    ).filter((s) => !(s.parentElement && s.parentElement.closest("[data-component='purchasedItems'], div.shipment")));
    return { items: productsIn(scopes) };
  }

  // ---------------------------------------------------------------------------

  /** A link on the page as a path on the same site, or null for anything else. */
  function sameSitePath(href) {
    if (!href) return null;
    let url;
    try {
      url = new URL(href, 'https://www.amazon.com');
    } catch (_) {
      return null;
    }
    if (url.origin !== 'https://www.amazon.com') return null;
    return url.pathname + url.search;
  }

  MTD.amazonParse = {
    parseDate,
    parseAmount,
    orderNumberIn,
    blockedReason,
    parseTransactionsPage,
    parseTransactionDataPage,
    parseOrderHistoryPage,
    parseOrderDetailsPage,
    sameSitePath,
  };
})(globalThis);
