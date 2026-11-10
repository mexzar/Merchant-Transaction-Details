/*
 * Builds the export: one entry per Amazon charge or refund, described by the
 * products in its order. Same file the desktop app writes
 * (src/merchant/formatter.py and exporter.py), so either one can be uploaded
 * or sent to Piggy Banks.
 *
 * Pure: no DOM, no network, no clock (the caller passes `now`).
 */
(function (root) {
  'use strict';
  const MTD = (root.MTD = root.MTD || {});

  // Piggy Banks keeps this many characters (UTF-16 units) of a description
  // and drops the rest, which would take the order number at the end with
  // it. The desktop app has no cap. Here, a description that would run over
  // lists the first products and says how many more there are.
  const MAX_DESCRIPTION = 400;
  const MAX_PRODUCT_CHARS = 60;
  const TRAILING_SEPS = /[\s\-,;:|/]+$/u;

  /** Cut a product title at its first comma and at 60 characters, on a word. */
  function truncateProductName(title, maxChars = MAX_PRODUCT_CHARS) {
    if (!title) return '';
    const name = title.split(',', 1)[0].trim();
    const chars = Array.from(name);
    if (chars.length <= maxChars) return name;
    let cut = chars.slice(0, maxChars - 1).join('');
    const space = cut.lastIndexOf(' ');
    if (space > 0) cut = cut.slice(0, space);
    cut = cut.replace(TRAILING_SEPS, '');
    return `${cut}…`;
  }

  function formatItem(item) {
    const name = truncateProductName(item && item.title ? String(item.title) : '');
    if (!name) return '';
    const qty = item.quantity;
    return Number.isInteger(qty) && qty > 1 ? `${qty}x ${name}` : name;
  }

  /**
   * "AMZN Mktp US", "AMZN Digital*ABC123", "Amazon.com*XYZ": card statement
   * names, not a product or a useful seller. An order number says more.
   */
  function isGenericAmazonDescriptor(seller) {
    const upper = seller.toUpperCase();
    return upper.startsWith('AMZN ') || upper.startsWith('AMAZON.COM*');
  }

  /** Keep the code points that fit in `max` UTF-16 units, never half a pair. */
  function cutToUnits(text, max) {
    let out = '';
    for (const ch of text) {
      if (out.length + ch.length > max) break;
      out += ch;
    }
    return out;
  }

  /**
   * The products, one per line, as many as fit between `prefix` and `suffix`
   * within MAX_DESCRIPTION. Products that do not fit become "+N more".
   */
  function fitProducts(parts, prefix, suffix) {
    const all = prefix + parts.join('\n') + suffix;
    if (all.length <= MAX_DESCRIPTION) return parts.join('\n');
    for (let keep = parts.length - 1; keep >= 1; keep--) {
      const body = `${parts.slice(0, keep).join('\n')}\n+${parts.length - keep} more`;
      if ((prefix + body + suffix).length <= MAX_DESCRIPTION) return body;
    }
    return cutToUnits(parts[0], MAX_DESCRIPTION - prefix.length - suffix.length);
  }

  /**
   * Describe one charge or refund, e.g. "Product A\n2x Product B - order 111-…".
   *
   * `transaction` is `{ amount, orderNumber, seller }` (amount negative for a
   * charge, positive for a refund). `order` is `{ items: [{ title, quantity }] }`
   * or null when the order could not be read. A refund starts "Return of ".
   * With no products, a seller name stands in unless it is a generic card
   * descriptor, and with neither, the order number alone does.
   */
  function composeDescription(transaction, order) {
    const isRefund = transaction.amount > 0;
    const orderNumber = transaction.orderNumber || '';
    const items = order && Array.isArray(order.items) ? order.items : [];
    const parts = items.map(formatItem).filter(Boolean);
    const prefix = isRefund ? 'Return of ' : '';
    const suffix = orderNumber ? ` - order ${orderNumber}` : '';

    let body = '';
    if (parts.length) {
      body = fitProducts(parts, prefix, suffix);
    } else {
      const seller = (transaction.seller || '').trim();
      if (seller && !isGenericAmazonDescriptor(seller)) {
        body = cutToUnits(seller, MAX_DESCRIPTION - prefix.length - suffix.length);
      }
    }

    if (body) return prefix + body + suffix;
    if (orderNumber) return `${isRefund ? 'Refund on order' : 'Order'} ${orderNumber}`;
    return '(unknown)';
  }

  /**
   * The export file. `transactions` are `{ date, amount, orderNumber, seller }`;
   * `orders` maps an order number to `{ items }`. The desktop app's `account`
   * (the Amazon sign-in email) is left out: nothing reads it, and the
   * extension never sees it.
   */
  function buildExport({ transactions, orders, rangeLabel, now }) {
    const entries = transactions.map((t) => ({
      merchant: 'Amazon',
      date: t.date,
      amount: t.amount,
      description: composeDescription(t, (t.orderNumber && orders.get(t.orderNumber)) || null),
    }));
    return {
      merchant: 'amazon',
      generated_at: now.toISOString(),
      range_label: rangeLabel,
      transaction_count: entries.length,
      transactions: entries,
    };
  }

  /** "amazon-transactions-20261110-142233.json", like the desktop app's files. */
  function exportFileName(now) {
    const p = (n) => String(n).padStart(2, '0');
    const stamp =
      `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-` +
      `${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
    return `amazon-transactions-${stamp}.json`;
  }

  MTD.format = {
    MAX_DESCRIPTION,
    truncateProductName,
    composeDescription,
    buildExport,
    exportFileName,
  };
})(globalThis);
