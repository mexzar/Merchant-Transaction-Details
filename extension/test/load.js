// Loads the extension's scripts the way the browser does (plain scripts that
// share one `MTD` global, in the order the extension injects them).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import '../lib/delivery.js';
import '../lib/format.js';
import '../lib/amazon-parse.js';
import '../lib/amazon-read.js';
import '../lib/handoff.js';

export const MTD = globalThis.MTD;

// Tests run from the extension folder (npm test); under the jsdom
// environment import.meta.url is not a file URL.
export function fixture(name) {
  return readFileSync(join(process.cwd(), 'test', 'fixtures', name), 'utf8');
}

export function parseHtml(html) {
  return new DOMParser().parseFromString(html, 'text/html');
}
