// Browser test: the real extension in Chromium, against made-up Amazon pages
// and a stand-in Piggy Banks import page (receiver.html). Run with
// `npm run test:browser`. Nothing leaves the machine: every request to
// amazon.com and piggybanksonline.com is answered here.
//
// The one difference from a real install: automation cannot click the
// toolbar button, which is what grants the Amazon tab (activeTab). The test
// copy of the extension is given amazon.com up front instead, and the test
// does what the popup's "Read" button does.
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('../../', import.meta.url).pathname;
const fixture = (name) => readFileSync(join(ROOT, 'test', 'fixtures', name), 'utf8');
const EMPTY = '<html><body></body></html>';

const AMAZON = {
  'GET /your-orders/orders': fixture('orders-2026.html'),
  'GET /cpe/yourpayments/transactions': fixture('payments-data.html'),
  'POST /payments-portal/data/iris/live/v1/data/manage/get-transactions': fixture('payments-data-page-2.json'),
  'GET /your-orders/orders?timeFilter=year-2026': fixture('orders-2026.html'),
  'GET /your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2': EMPTY,
  'GET /gp/your-account/order-details?orderID=111-0000000-0000002': EMPTY,
  'GET /gp/your-account/order-details?orderID=D01-0000000-0000003': fixture('order-details-digital.html'),
};

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

const amazonRequests = [];
await context.route('https://www.amazon.com/**', async (route) => {
  const req = route.request();
  const url = new URL(req.url());
  const key = `${req.method()} ${url.pathname}${url.search}`;
  if (req.resourceType() === 'fetch') amazonRequests.push({ key, at: Date.now(), headers: req.headers(), body: req.postData() });
  const body = AMAZON[key];
  if (body === undefined) return route.fulfill({ status: 404, body: `unexpected ${key}` });
  const json = key.startsWith('POST /payments-portal');
  await route.fulfill({ status: 200, contentType: json ? 'application/json' : 'text/html', body });
});
await context.route('https://piggybanksonline.com/**', (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: readFileSync(join(ROOT, 'test/browser/receiver.html'), 'utf8') }),
);
await context.route(/^https?:\/\/(?!www\.amazon\.com|piggybanksonline\.com)/, (route) => route.abort());

let failed = false;
try {
  const worker = context.serviceWorkers()[0] || (await context.waitForEvent('serviceworker'));
  const extId = new URL(worker.url()).host;

  // 1. The user's signed-in Amazon tab.
  const amazon = await context.newPage();
  await amazon.goto('https://www.amazon.com/your-orders/orders');
  const amazonTabId = await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.amazon.com/*' });
    return tab.id;
  });

  // 2. The popup, and what its "Read my Amazon purchases" button does.
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extId}/popup/popup.html`);
  await popup.evaluate(async (tabId) => {
    const begun = await chrome.runtime.sendMessage({ type: 'read-begin', tabId, rangeKey: 'months-3' });
    if (!begun) throw new Error('read-begin refused');
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['lib/delivery.js', 'lib/format.js', 'lib/amazon-parse.js', 'lib/amazon-read.js', 'content/amazon-reader.js'],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      func: (key) => {
        globalThis.MTD.reader.start({ rangeKey: key });
      },
      args: ['months-3'],
    });
  }, amazonTabId);

  // The popup follows the read and then offers to send.
  await popup.locator('#ready:not([hidden])').waitFor({ timeout: 30_000 });
  assert.equal(await popup.locator('#summary').textContent(), '4 charges and refunds from the last 3 months.');
  assert.equal(
    await popup.locator('#caveats li').allTextContents().then((t) => t.join(' | ')),
    'Products found for 3 of 4 orders. The rest show the order number.',
  );

  // The tab's requests: same site, one at a time, paced, in this order.
  assert.deepEqual(
    amazonRequests.map((r) => r.key),
    [
      'GET /cpe/yourpayments/transactions',
      'POST /payments-portal/data/iris/live/v1/data/manage/get-transactions',
      'GET /your-orders/orders?timeFilter=year-2026',
      'GET /your-orders/orders?timeFilter=year-2026&startIndex=10&ref_=ppx_yo2ov_dt_b_pagination_1_2',
      'GET /gp/your-account/order-details?orderID=111-0000000-0000002',
      'GET /gp/your-account/order-details?orderID=D01-0000000-0000003',
    ],
  );
  const reads = amazonRequests;
  for (let i = 1; i < reads.length; i++) assert.ok(reads[i].at - reads[i - 1].at >= 900, 'requests are paced');
  const dataRequest = reads[1];
  assert.equal(dataRequest.headers['x-amzn-upx-token'], 'upx-token-1');
  assert.equal(JSON.parse(dataRequest.body).exclusiveStartKey, 'page-key-1');

  // 3. Send: the extension opens the import page and hands the export over.
  const importOpened = context.waitForEvent('page');
  await popup.locator('#send-button').click();
  const importPage = await importOpened;
  // Automation attaches to a tab the extension opens only after its first
  // load has started, so the routes above miss it and it fails (no real
  // lookups). Load it again, as a user reloading the tab would: the
  // extension still owes this tab the export and delivers it.
  await importPage.waitForLoadState();
  await importPage.goto('https://piggybanksonline.com/import-details');
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
      [
        '2026-09-02',
        -1204.5,
        'Slime Kit for Kids\n3x Flower Party Balloons - order 111-0000000-0000004',
      ],
    ],
  );

  // The export is gone from the extension once Piggy Banks took it.
  await popup.locator('#sent:not([hidden])').waitFor({ timeout: 10_000 });
  const state = await worker.evaluate(async () => (await chrome.storage.session.get('state')).state);
  assert.equal(state.phase, 'sent');
  assert.equal(state.exportText, null);

  // 4. An import page the user opens on their own gets nothing.
  const other = await context.newPage();
  await other.goto('https://piggybanksonline.com/import-details');
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
