// MIT — Carlos Felipe, with AI assistance. Isolated synthetic-fixture experiment.
import { get } from 'node:http';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

export const LIMITS = Object.freeze({ bytes: 65536, textChars: 2000, httpMs: 2000, browserMs: 4000, launchMs: 5000 });
const digest = value => createHash('sha256').update(value).digest('hex');
export class StudyError extends Error {
  constructor(code) { super(code); this.name = 'StudyError'; this.code = code; }
}
const fail = code => { throw new StudyError(code); };

function sourceUrl(input, lab) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).sort().join(',') !== 'mode,sourceId'
    || !['http', 'browser'].includes(input.mode)
    || typeof input.sourceId !== 'string' || !lab.ids.includes(input.sourceId)) fail('INVALID_INPUT');
  // The lab is operator-owned, never model/request supplied. No arbitrary URL option in CLI/API.
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(lab.origin)) fail('INVALID_LAB');
  return `${lab.origin}/fixtures/${input.sourceId}`;
}

function readFixture(url) {
  return new Promise((resolve, reject) => {
    let done = false;
    let timer;
    const finish = (error, body) => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) { request.destroy(); reject(new StudyError(error)); } else resolve(body);
    };
    // No cookies, proxy, credentials, retries or redirects; only our loopback fixture server.
    const request = get(url, { headers: { Accept: 'text/html', 'Accept-Encoding': 'identity' } }, response => {
      if (response.statusCode !== 200) return finish('HTTP_STATUS');
      if (!/^text\/html(?:;|$)/i.test(response.headers['content-type'] ?? '')
        || !['identity', undefined].includes(response.headers['content-encoding'])) return finish('CONTENT_TYPE');
      const chunks = [];
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > LIMITS.bytes) return finish('BYTE_LIMIT');
        chunks.push(chunk);
      });
      response.on('end', () => finish(null, Buffer.concat(chunks)));
      response.on('error', () => finish('TRANSPORT'));
    });
    request.on('error', () => finish('TRANSPORT'));
    timer = setTimeout(() => finish('HTTP_TIMEOUT'), LIMITS.httpMs);
  });
}

function normalize(values) {
  if (values.length !== 1) return null;
  const text = values[0].replace(/\s+/g, ' ').trim();
  if (text.length > LIMITS.textChars) fail('TEXT_LIMIT');
  return text || null;
}
function httpText(body) {
  // This tiny parser is deliberately limited to the fixed synthetic <p> contract.
  // It is not a general HTML parser or a public-source extraction algorithm.
  const clean = body.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return normalize([...clean.matchAll(/<p data-radar-evidence>([^<]*)<\/p>/g)].map(match => match[1]));
}

async function browserText(url, body) {
  // No persistent context, CDP connection, extension, credential or existing user profile.
  // Chromium sandbox stays at Playwright's default (false): TRUSTED FIXTURES ONLY.
  let browser;
  try { browser = await chromium.launch({ headless: true, timeout: LIMITS.launchMs }); }
  catch { throw new StudyError('BROWSER_UNAVAILABLE'); }
  let context;
  let timer;
  let denied = false;
  let navigations = 0;
  try {
    context = await browser.newContext({ acceptDownloads: false, serviceWorkers: 'block', permissions: [] });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new StudyError('BROWSER_TIMEOUT')), LIMITS.browserMs);
    });
    const execute = async () => {
      // All document/resource traffic is intercepted before any page exists.
      // Only a single main document is fulfilled, using the already capped HTTP body.
      await context.route('**/*', async route => {
        const request = route.request();
        if (request.url() !== url || request.method() !== 'GET' || !request.isNavigationRequest()
          || request.frame().parentFrame() !== null || ++navigations !== 1) {
          denied = true; await route.abort(); return;
        }
        await route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body });
      });
      await context.routeWebSocket('**/*', async socket => { denied = true; await socket.close(); });
      context.on('page', page => {
        if (context.pages().length > 1) { denied = true; void page.close().catch(() => {}); }
        page.on('frameattached', () => { denied = true; });
        page.on('download', download => { denied = true; void download.cancel().catch(() => {}); });
        page.on('dialog', dialog => { denied = true; void dialog.dismiss().catch(() => {}); });
      });
      const page = await context.newPage();
      await page.goto(url, { waitUntil: 'load', timeout: LIMITS.browserMs });
      // Bounded collection point for these synchronous fixture scripts, not networkidle.
      const values = await page.locator('[data-radar-evidence]').allTextContents();
      if (denied || context.pages().length !== 1 || context.serviceWorkers().length !== 0) fail('POLICY_DENIED');
      return normalize(values);
    };
    return await Promise.race([execute(), deadline]);
  } catch (error) {
    if (error instanceof StudyError) throw error;
    throw new StudyError(denied ? 'POLICY_DENIED' : 'BROWSER_FAILED');
  } finally {
    clearTimeout(timer);
    if (context) await context.close().catch(() => {});
    await browser.close();
  }
}

export async function capture(input, lab) {
  const url = sourceUrl(input, lab);
  const started = performance.now();
  const body = await readFixture(url);
  const text = input.mode === 'http' ? httpText(body.toString('utf8')) : await browserText(url, body);
  return {
    text,
    receipt: {
      schema: 'radar.synthetic-capture.v1', source_id: input.sourceId, mode: input.mode,
      scope: 'synthetic-fixture-only', outcome: text === null ? 'abstained' : 'captured',
      source_sha256: digest(body), content_sha256: text === null ? null : digest(text),
      bytes: body.length, elapsed_ms: Math.round((performance.now() - started) * 100) / 100,
      review_status: 'pending', identity_verified: false, paid_enabled: false, provider_cost: 0,
    },
  };
}
