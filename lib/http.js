const { Readable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const CACHE_TTL_MS = 2 * 60 * 1000;
const htmlCache = new Map();
let browserPromise = null;

function looksLikeCloudflare(html, status) {
  if (!html) return false;
  if (status === 403 || status === 503) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes('attention required') ||
    lower.includes('cloudflare') ||
    lower.includes('cf-browser-verification')
  );
}

function getCached(url) {
  const entry = htmlCache.get(url);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) {
    htmlCache.delete(url);
    return null;
  }
  return entry.value;
}

function setCached(url, value) {
  htmlCache.set(url, { at: Date.now(), value });
}

async function fetchHtmlPlain(url) {
  const res = await fetch(url, {
    headers: {
      'user-agent': USER_AGENT,
      'accept-language': 'en-US,en;q=0.9,id;q=0.8'
    }
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function fetchHtmlPlaywright(url) {
  let playwright;
  try {
    playwright = require('playwright');
  } catch (err) {
    const error = new Error(
      'Playwright tidak terpasang. Install dengan: npm install && npx playwright install chromium'
    );
    error.code = 'PLAYWRIGHT_NOT_INSTALLED';
    throw error;
  }

  if (!browserPromise) {
    browserPromise = playwright.chromium.launch({ headless: true });
  }
  const browser = await browserPromise;
  const page = await browser.newPage({
    userAgent: USER_AGENT,
    locale: 'id-ID'
  });
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await delay(500);
    const html = await page.content();
    return { status: 200, text: html };
  } finally {
    await page.close();
  }
}

async function fetchHtmlJina(url) {
  const target = `https://r.jina.ai/${url}`;
  const res = await fetch(target, {
    headers: {
      'user-agent': USER_AGENT
    }
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function getHtml(url, opts = {}) {
  const cached = getCached(url);
  if (cached) return cached;

  const usePlaywright = Boolean(
    opts.usePlaywright || process.env.USE_PLAYWRIGHT === '1'
  );
  const useJina = Boolean(opts.useJina || process.env.USE_JINA === '1');

  let plain;
  try {
    plain = await fetchHtmlPlain(url);
  } catch (err) {
    if (!usePlaywright) throw err;
  }

  if (plain && !looksLikeCloudflare(plain.text, plain.status)) {
    setCached(url, plain.text);
    return plain.text;
  }

  if (useJina) {
    const rendered = await fetchHtmlJina(url);
    setCached(url, rendered.text);
    return rendered.text;
  }

  if (!usePlaywright) {
    const error = new Error(
      'Halaman diblokir Cloudflare. Aktifkan Playwright atau USE_JINA=1.'
    );
    error.code = 'CLOUDFLARE_BLOCK';
    throw error;
  }

  const rendered = await fetchHtmlPlaywright(url);
  setCached(url, rendered.text);
  return rendered.text;
}

async function proxyImage(req, res, imageUrl, referer) {
  const upstream = await fetch(imageUrl, {
    headers: {
      'user-agent': USER_AGENT,
      referer: referer || imageUrl
    }
  });

  if (!upstream.ok || !upstream.body) {
    res.status(upstream.status || 502).end();
    return;
  }

  const contentType = upstream.headers.get('content-type');
  if (contentType) res.setHeader('content-type', contentType);
  res.setHeader('cache-control', 'public, max-age=86400');

  const stream = Readable.fromWeb(upstream.body);
  stream.pipe(res);
}

function isM3U8(url, contentType) {
  if (contentType) {
    const lower = contentType.toLowerCase();
    if (lower.includes('application/vnd.apple.mpegurl')) return true;
    if (lower.includes('application/x-mpegurl')) return true;
    if (lower.includes('audio/mpegurl')) return true;
  }
  return /\.m3u8($|\?)/i.test(url || '');
}

function buildProxyUrl(url, referer) {
  if (!url) return '';
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  return `/api/stream?${params.toString()}`;
}

function rewriteM3U8(content, baseUrl, referer) {
  if (!content) return content;
  const lines = content.split(/\r?\n/);
  return lines
    .map((line) => {
      if (!line) return line;
      let updated = line;
      if (line.includes('URI=')) {
        updated = updated.replace(/URI="([^"]+)"/g, (match, uri) => {
          try {
            const absolute = new URL(uri, baseUrl).toString();
            return `URI=\"${buildProxyUrl(absolute, referer)}\"`;
          } catch (err) {
            return match;
          }
        });
        updated = updated.replace(/URI='([^']+)'/g, (match, uri) => {
          try {
            const absolute = new URL(uri, baseUrl).toString();
            return `URI='${buildProxyUrl(absolute, referer)}'`;
          } catch (err) {
            return match;
          }
        });
      }
      if (updated.startsWith('#')) return updated;
      try {
        const absolute = new URL(updated, baseUrl).toString();
        return buildProxyUrl(absolute, referer);
      } catch (err) {
        return updated;
      }
    })
    .join('\n');
}

async function proxyStream(req, res, streamUrl, referer) {
  const headers = {
    'user-agent': USER_AGENT
  };
  if (referer) headers.referer = referer;
  if (req.headers.range) headers.range = req.headers.range;

  const upstream = await fetch(streamUrl, { headers });
  if (!upstream.ok && upstream.status !== 206) {
    res.status(upstream.status || 502).end();
    return;
  }

  const contentType = upstream.headers.get('content-type') || '';
  if (isM3U8(streamUrl, contentType)) {
    const text = await upstream.text();
    const rewritten = rewriteM3U8(text, streamUrl, referer);
    res.setHeader(
      'content-type',
      contentType || 'application/vnd.apple.mpegurl'
    );
    res.setHeader('cache-control', 'no-cache');
    res.status(200).send(rewritten);
    return;
  }

  if (contentType) res.setHeader('content-type', contentType);
  const contentLength = upstream.headers.get('content-length');
  if (contentLength) res.setHeader('content-length', contentLength);
  const acceptRanges = upstream.headers.get('accept-ranges');
  if (acceptRanges) res.setHeader('accept-ranges', acceptRanges);
  const contentRange = upstream.headers.get('content-range');
  if (contentRange) res.setHeader('content-range', contentRange);
  res.setHeader('cache-control', 'public, max-age=3600');
  res.status(upstream.status);

  if (!upstream.body) {
    res.end();
    return;
  }
  const stream = Readable.fromWeb(upstream.body);
  stream.pipe(res);
}

async function closeBrowser() {
  if (browserPromise) {
    const browser = await browserPromise;
    await browser.close();
    browserPromise = null;
  }
}

module.exports = {
  getHtml,
  proxyImage,
  proxyStream,
  closeBrowser,
  looksLikeCloudflare
};
