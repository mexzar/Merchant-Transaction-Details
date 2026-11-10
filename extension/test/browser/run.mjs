// Browser test: the real extension in Chromium, against made-up Amazon pages
// and a stand-in Piggy Banks import page (receiver.html). Run with
// `npm run test:browser`. Nothing leaves the machine: requests to amazon.com
// and piggybanksonline.com are answered here, and every other lookup fails.
//
// The one difference from a real install: automation cannot click the
// toolbar button, which is what grants the Amazon tab (activeTab). The test
// copy of the extension is given amazon.com up front instead, and the test
// does what the popup's "Read" button does (startRead below).
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const fixture = (name) => readFileSync(join(ROOT, 'test', 'fixtures', name), 'utf8');
const EMPTY = '<html><body></body></html>';
const IMPORT_URL = 'https://piggybanksonline.com/import-details';

const AMAZON = {
  'GET /your-orders/orders': fixture('orders-2026.html'),
  'GET /your-orders/orders?somewhere-else': EMPTY,
  'GET /cpe/yourpayments/transactions': fixture('payments-data.html'),
  'POST /payments-portal/data/iris/live/v1/data/manage/get-transactions': fixture('payments-data-page-2.json'),
  'GET /your-orders/orders?timeFilter=year-2026': fixture('orders-2026.html'),
  'GET /your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2': EMPTY,
  'GET /gp/your-account/order-details?orderID=111-0000000-0000002': EMPTY,
  'GET /gp/your-account/order-details?orderID=D01-0000000-0000003': fixture('order-details-digital.html'),
};
const READ_REQUESTS = [
  'GET /cpe/yourpayments/transactions',
  'POST /payments-portal/data/iris/live/v1/data/manage/get-transactions',
  'GET /your-orders/orders?timeFilter=year-2026',
  'GET /your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2',
  'GET /gp/your-account/order-details?orderID=111-0000000-0000002',
  'GET /gp/your-account/order-details?orderID=D01-0000000-0000003',
];

const work = mkdtempSync(join(tmpdir(), 'mtd-browser-'));
const extDir = join(work, 'extension');
cpSync(ROOT, extDir, {
  recursive: true,
  filter: (src) => !/node_modules|test-results|[/\\]dist([/\\]|$)/.test(src.slice(ROOT.length)),
});
const manifest = JSON.parse(readFileSync(join(extDir, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://www.amazon.com/*'];
writeFileSync(join(extDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

const context = await chromium.launchPersistentContext(join(work, 'profile'), {
  channel: 'chromium',
  headless: true,
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    // No real lookups: a request the routes below do not answer fails here
    // instead of reaching the real site.
    '--host-resolver-rules=MAP * ~NOTFOUND',
  ],
});

let amazonRequests = [];
await context.route('https://www.amazon.com/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const key = `${req.method()} ${url.pathname}${url.search}`;
  if (req.resourceType() === 'fetch') {
    amazonRequests.push({ key, at: Date.now(), headers: req.headers(), body: req.postData() });
  }
  const body = AMAZON[key];
  if (body === undefined) return route.fulfill({ status: 404, body: `unexpected ${key}` });
  const json = key.startsWith('POST /payments-portal');
  await route.fulfill({ status: 200, contentType: json ? 'application/json' : 'text/html', body });
});
await context.route('https://piggybanksonline.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(ROOT, 'test/browser/receiver.html'), 'utf8') }),
);

let failed = false;
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;
  const state = () => worker.evaluate(async () => (await chrome.storage.session.get('state')).state);
  async function waitForPhase(phase, timeout = 30_000) {
    const end = Date.now() + timeout;
    for (;;) {
      const s = await state();
      if (s && s.phase === phase) return s;
      if (Date.now() > end) throw new Error(`phase stayed ${s && s.phase}, wanted ${phase}`);
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // The user's signed-in Amazon tab.
  const amazon = await context.newPage();
  await amazon.goto('https://www.amazon.com/your-orders/orders');
  const amazonTabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.amazon.com/*' });
    return tab.id;
  });

  // The popup, and what its "Read my Amazon purchases" button does.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  const startRead = (rangeKey = 'months-3') =>
    popup.evaluate(
      async ({ tabId, key }) => {
        const D = globalThis.MTD.delivery;
        const begun = await chrome.runtime.sendMessage({ type: 'read-begin', tabId, rangeKey: key });
        if (!begun) throw new Error('read-begin refused');
        await chrome.scripting.executeScript({ target: { tabId }, world: 'ISOLATED', files: D.READER_FILES });
        await chrome.scripting.executeScript({
          target: { tabId },
          world: 'ISOLATED',
          func: (k, id) => {
            globalThis.MTD.reader.start({ rangeKey: k, readId: id });
          },
          args: [key, begun.readId],
        });
      },
      { tabId: amazonTabId, key: rangeKey },
    );

  // 1. Stop, then read again straight away: the second read runs.
  await startRead();
  await popup.locator('#progress', { hasText: 'so far' }).waitFor();
  await popup.locator('#stop-button').click();
  await waitForPhase('idle');
  amazonRequests = [];
  await startRead();
  await waitForPhase('ready');
  assert.deepEqual(
    amazonRequests.map((r) => r.key),
    READ_REQUESTS,
    'the second read ran in full',
  );
  // The tab's requests: same site, one at a time, paced.
  for (let i = 1; i < amazonRequests.length; i++) {
    assert.ok(amazonRequests[i].at - amazonRequests[i - 1].at >= 900, 'requests are paced');
  }
  assert.equal(amazonRequests[1].headers['x-amzn-upx-token'], 'upx-token-1');
  assert.equal(JSON.parse(amazonRequests[1].body).exclusiveStartKey, 'page-key-1');
  await popup.locator('#ready:not([hidden])').waitFor();
  assert.equal(await popup.locator('#summary').textContent(), '4 charges and refunds from the last 3 months.');
  assert.equal(
    (await popup.locator('#caveats li').allTextContents()).join(' | '),
    'Product names found for 3 of 4 orders. The rest have the seller or the order number instead.',
  );
  await popup.locator('#discard-button').click();
  await waitForPhase('idle');

  // 2. The Amazon tab leaves the page mid-read: the read fails instead of
  // showing "reading" forever.
  await startRead();
  await popup.locator('#progress', { hasText: 'so far' }).waitFor();
  await amazon.goto('https://www.amazon.com/your-orders/orders?somewhere-else');
  const left = await waitForPhase('failed', 15_000);
  assert.equal(left.error, 'tab-left');
  await popup.locator('#retry-button').click();
  await waitForPhase('idle');

  // 3. Read, then Send, then Cancel before the import page answers: the
  // page gets nothing, and the export waits to be sent again.
  await amazon.goto('https://www.amazon.com/your-orders/orders');
  await startRead();
  await waitForPhase('ready');
  let opened = context.waitForEvent('page');
  await popup.locator('#send-button').click();
  const heldTab = await opened;
  // Automation attaches to a tab the extension opens only after its first
  // load has started, so the routes miss it and it fails (no real lookups).
  // Load it again, as a user reloading the tab would: the extension still
  // owes this tab the export.
  await heldTab.waitForLoadState();
  await heldTab.goto(`${IMPORT_URL}?hold`);
  await heldTab.waitForTimeout(1500);
  await popup.locator('#cancel-send-button').click();
  const cancelled = await waitForPhase('ready');
  assert.ok(cancelled.exportText, 'the export is kept after Cancel');
  await heldTab.evaluate(() => window.__release());
  await heldTab.waitForTimeout(2500);
  assert.deepEqual(await heldTab.evaluate(() => window.__taken), [], 'nothing delivered after Cancel');

  // 4. Send again: a new tab, delivered once.
  opened = context.waitForEvent('page');
  await popup.locator('#send-button').click();
  const importPage = await opened;
  assert.notEqual(importPage, heldTab, 'Send opens a new tab');
  await importPage.waitForLoadState();
  await importPage.goto(IMPORT_URL);
  await importPage.locator('#status', { hasText: 'Imported' }).waitFor({ timeout: 30_000 });
  const taken = await importPage.evaluate(() => window.__taken);
  assert.equal(taken.length, 1, 'delivered once');
  const file = JSON.parse(taken[0]);
  assert.equal(file.merchant, 'amazon');
  assert.equal(file.range_label, 'Last 3 months');
  assert.deepEqual(
    file.transactions.map((t) => [t.date, t.amount, t.description]),
    [
      ['2026-11-08', -19.99, '2x Dry Erase Markers - order 111-0000000-0000001'],
      ['2026-11-06', 16.23, 'Refund on order 111-0000000-0000002'],
      ['2026-10-30', -7.46, 'The Example Novel (Kindle Edition) - order D01-0000000-0000003'],
      ['2026-09-02', -1204.5, 'Slime Kit for Kids\n3x Flower Party Balloons - order 111-0000000-0000004'],
    ],
  );

  // Sent: the export stays until Done, so it can be sent again.
  await popup.locator('#sent:not([hidden])').waitFor({ timeout: 10_000 });
  assert.ok((await state()).exportText, 'kept until Done');
  await popup.locator('#done-button').click();
  const done = await waitForPhase('idle');
  assert.equal(done.exportText, null);

  // 5. An import page the user opens on their own gets nothing.
  const other = await context.newPage();
  await other.goto(IMPORT_URL);
  await other.locator('#status', { hasText: 'Ready' }).waitFor();
  await other.waitForTimeout(2500);
  assert.deepEqual(await other.evaluate(() => window.__taken), []);
  // It hears its own `ready`, and nothing from the extension.
  assert.deepEqual(await other.evaluate(() => window.__heard), ['ready']);

  console.log('browser test passed');
} catch (e) {
  failed = true;
  console.error(e);
} finally {
  await context.close();
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
