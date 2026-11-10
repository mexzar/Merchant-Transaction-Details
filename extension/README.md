# Merchant Transaction Details: browser extension

Reads your Amazon purchases from the Amazon tab you are already signed in to,
and hands them to your Piggy Banks import page, where each purchase's
products are added to the note on the matching bank transaction. No password
to type, no separate app to run.

It writes the same file as the desktop app in this repository, so you can
also save it and upload it on the import page yourself.

## Install

Chrome, Edge, Brave and other Chromium browsers, version 116 or newer.

1. Download this repository (green **Code** button → **Download ZIP**) and
   unpack it.
2. Open `chrome://extensions` (Edge: `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the `extension` folder.
5. Pin **Merchant Transaction Details** to the toolbar so it is easy to find.

To update, replace the folder with a newer download and click the reload
arrow on the extension's card.

## Use

1. Open [Your Orders](https://www.amazon.com/your-orders/orders) on
   amazon.com, signed in.
2. Click the extension's button. Pick how far back to read (last 30 days, 3,
   6 or 12 months) and click **Read my Amazon purchases**. It takes a minute
   or two, a few minutes for 12 months. Leave that tab on its page until it
   is done; other tabs are fine.
3. Click **Send to Piggy Banks**. The import page opens in a new tab and adds
   the products to your transactions. It shows how many it updated.
   - Not signed in to Piggy Banks? Sign in in that tab, then click **Send
     again**.
   - **Save as a file** keeps a copy you can upload on the import page
     yourself.
4. Click **Done** to clear the purchases from the extension.

Sending the same purchases twice changes nothing the second time.

## What it reads, and what it sends

- **It reads** three kinds of Amazon page, as you, in the tab you clicked in:
  Your Payments (the charges and refunds your bank sees), Your Orders (what
  each order contained) and, for an order not listed there (digital orders,
  for instance), that order's details page. One request at a time, a second
  apart, at most about 165 pages in one read.
- **It stops** at any sign-in page, CAPTCHA or "is it you?" check, and tells
  you. It never answers one. Those pages come back to the extension, not to
  your screen, so reload the Amazon tab, do what Amazon asks, then read again.
- **It keeps** the result in the browser's memory until you click **Done**
  or **Discard**, so you can send it again if the import page could not load
  your account. Closing the browser clears it.
- **It sends** the result only to the Piggy Banks import page it opened
  (piggybanksonline.com), and only after you click **Send**. **Cancel** stops
  it up to the moment it is handed over. If that tab is reloaded before
  Piggy Banks confirms, it is handed over again, which adds nothing new.
  Piggy Banks answers only "ready" and "received". Any script running on the
  import page can read what is handed over, as it can read the rest of that
  page. Nothing else leaves your browser: no analytics, no servers of ours, no
  code loaded from anywhere.

For each charge or refund the file holds the date, the amount and a
description:

```
Crayola Dry Erase Marker
2x Swim Goggles - order 111-0000000-0000001
```

One product per line, cut to 60 characters, then the order number. A refund
starts with "Return of". A long order lists its first products and how many
more. When the products cannot be read (Whole Foods, Amazon Fresh and
in-store purchases, for instance), the description is the name Amazon shows
for the charge ("Prime Video Channels"), or the order number alone when that
name is a generic one like "AMZN Mktp US". Anything that looks like a payment
card is never used.

## Permissions

| Permission | Why |
|---|---|
| Read the tab you click in (`activeTab`, `scripting`) | To read Amazon in that tab. Only when you click the button, only that tab, and not after it leaves the page. The extension has no standing access to Amazon. |
| Storage (`storage`) | To keep the result in memory until you click Done. |
| piggybanksonline.com | To hand the result to the import page in the tab **Send** opened. Chrome describes this as access to piggybanksonline.com; the extension's script runs only on the import page, and does nothing there unless **Send** opened it. |
| Piggy Banks test site (optional) | Only if you turn on **Send to the Piggy Banks test site** in Settings. Your browser asks first. While it is on, **Send** goes to the test site; turn it off to send to piggybanksonline.com. |

## Limits

- amazon.com, with the account set to English. Other Amazon sites, and
  accounts in another language, are not read: the extension says it could
  not read them.
- Up to 25 order details pages per read; past that, a purchase is described
  as when its products cannot be read.
- Amazon changes its pages. When it does, the extension says it could not
  read them rather than guessing.

## How it keeps Piggy Banks separate

Piggy Banks never contacts Amazon, never sees your Amazon sign-in, and
doesn't link to or name this tool. The extension runs in your browser, as
you, when you click. It delivers through a message in the import page's own
tab, and the page accepts it only from that tab and site. See the Piggy Banks
side's contract (`Specs/MERCHANT_DETAILS_IMPORT.md` in the Piggy Banks
repository).

## Development

```bash
cd extension
npm install
npm test               # unit tests (format, Amazon pages, reading, handoff, delivery rules)
npm run test:browser   # the extension in a real Chromium, offline, against made-up pages
npm run package        # dist/merchant-transaction-details-<version>.zip
npm run icons          # redraw icons/
```

The browser test needs Playwright's Chromium (`npx playwright install
chromium` once). Every page in the tests is made up; no request leaves the
machine.

```
manifest.json           permissions, the import page's content script
background.js           keeps the state, opens the import page, hands over the export
popup/                  the toolbar popup
content/amazon-reader.js  injected into your Amazon tab when you click Read
content/piggybanks.js   runs on the import page; delivers when Send opened it
lib/amazon-parse.js     reads Amazon's pages (shapes from amazon-orders)
lib/amazon-read.js      the read: payments, then orders, then details
lib/format.js           the export file and its descriptions
lib/handoff.js          the message exchange with the import page
lib/delivery.js         the state and who may change it
```

The page shapes follow [`alexdlaird/amazon-orders`](https://github.com/alexdlaird/amazon-orders)
(MIT), the library the desktop app uses.
