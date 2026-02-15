const cheerio = require('cheerio');
const { setTimeout: delay } = require('node:timers/promises');
const { getHtml, looksLikeCloudflare, getPlaywrightBrowser } = require('../lib/http');

const baseUrl = 'https://tv8.lk21official.cc';
const USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function absoluteUrl(href) {
  if (!href) return null;
  try {
    return new URL(href, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

function cleanText(value) {
  if (!value) return '';
  return value.replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url) {
  if (!url) return url;
  const normalized = url.split('#')[0].split('?')[0];
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function cleanTitle(raw) {
  if (!raw) return '';
  let title = cleanText(raw);
  title = title.replace(/^Nonton\s+/i, '').trim();
  title = title.replace(/\s+Sub\s*Indo.*$/i, '').trim();
  title = title.replace(/\s+di\s+Lk21.*$/i, '').trim();
  return title;
}

function dedupeByUrl(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item.url) continue;
    const key = item.url;
    if (!seen.has(key)) {
      seen.set(key, item);
      continue;
    }
    const existing = seen.get(key);
    if (!existing.title && item.title) existing.title = item.title;
    if (!existing.cover && item.cover) existing.cover = item.cover;
    if (!existing.quality && item.quality) existing.quality = item.quality;
  }
  return Array.from(seen.values());
}

async function fetchPage(url) {
  return getHtml(url, {
    usePlaywright: process.env.USE_PLAYWRIGHT === '1',
    useJina: process.env.USE_JINA === '1'
  });
}

function extractIdFromUrl(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const fromQuery = parsed.searchParams.get('id');
    if (fromQuery) return fromQuery;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    return parts[parts.length - 1];
  } catch (err) {
    return null;
  }
}

function normalizePlayerUrl(url) {
  if (!url) return null;
  try {
    return new URL(url, baseUrl).toString();
  } catch (err) {
    return null;
  }
}

function isHydraxUrl(url) {
  if (!url) return false;
  const lower = String(url).toLowerCase();
  return (
    lower.includes('/hydrax/') ||
    lower.includes('short.icu') ||
    lower.includes('abysscdn.com')
  );
}

function extractHydraxId(url) {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const v = parsed.searchParams.get('v');
    if (v) return v;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const hydraxIndex = parts.indexOf('hydrax');
    if (hydraxIndex !== -1 && parts[hydraxIndex + 1]) {
      return parts[hydraxIndex + 1];
    }
    return parts[parts.length - 1];
  } catch (err) {
    return null;
  }
}

function collectPlayerCandidates($) {
  const items = [];

  $('a[data-server][data-url]').each((_, el) => {
    const url = normalizePlayerUrl($(el).attr('data-url') || $(el).attr('href'));
    const server = cleanText($(el).attr('data-server') || '').toLowerCase();
    if (!url) return;
    items.push({ url, server });
  });

  $('#player-select option').each((_, el) => {
    const url = normalizePlayerUrl($(el).attr('value'));
    const server = cleanText($(el).attr('data-server') || '').toLowerCase();
    if (!url) return;
    items.push({ url, server });
  });

  const seen = new Set();
  return items.filter((item) => {
    if (!item.url) return false;
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

function pickPlayer(candidates, preferredServers) {
  if (!candidates || candidates.length === 0) return null;
  for (const pref of preferredServers) {
    const match = candidates.find((item) => item.server === pref);
    if (match) return match;
  }
  return candidates[0];
}

function sortCandidates(candidates, preferredServers) {
  if (!Array.isArray(candidates) || !candidates.length) return [];
  if (!preferredServers || !preferredServers.length) return [...candidates];
  const order = new Map(
    preferredServers.map((name, index) => [name, index])
  );
  return [...candidates].sort((a, b) => {
    const ai = order.has(a.server) ? order.get(a.server) : 999;
    const bi = order.has(b.server) ? order.get(b.server) : 999;
    if (ai !== bi) return ai - bi;
    return 0;
  });
}

async function resolvePlayerInfo(iframeUrl) {
  if (!iframeUrl) return null;
  let id = extractIdFromUrl(iframeUrl);
  let apiBase = null;

  try {
    const html = await fetchPage(iframeUrl);
    const match = html.match(
      /https?:\/\/[^'"\s]+\/video\.php\?id=([A-Za-z0-9_-]+)/i
    );
    if (match) {
      apiBase = new URL(match[0]).origin;
      id = match[1] || id;
    }
  } catch (err) {
    // ignore and fallback to defaults
  }

  if (!id) return null;
  if (!apiBase) apiBase = 'https://cloud.hownetwork.xyz';
  return {
    id,
    apiBase,
    apiHost: new URL(apiBase).hostname
  };
}

function findStreamUrl(html) {
  if (!html) return null;
  const direct =
    html.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/i) ||
    html.match(/https?:\/\/[^'"\s]+\.mp4[^'"\s]*/i);
  if (direct) return direct[0];

  const fileMatch = html.match(
    /file\s*[:=]\s*\"(https?:\/\/[^\"\s]+)\"/i
  );
  if (fileMatch) return fileMatch[1];

  const atobRegex = /atob\(['"]([^'"]+)['"]\)/gi;
  let match;
  while ((match = atobRegex.exec(html))) {
    try {
      const decoded = Buffer.from(match[1], 'base64').toString('utf8');
      const hit =
        decoded.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/i) ||
        decoded.match(/https?:\/\/[^'"\s]+\.mp4[^'"\s]*/i);
      if (hit) return hit[0];
    } catch (err) {
      // ignore decode errors
    }
  }

  return null;
}

function findPosterUrl(html) {
  if (!html) return null;
  const og = html.match(/property=\"og:image\"\\s*content=\"([^\"]+)\"/i);
  if (og) return og[1];
  const poster = html.match(/poster=\"([^\"]+)\"/i);
  if (poster) return poster[1];
  return null;
}

async function waitForAbyssFrame(page, timeoutMs = 30000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const frame = page
      .frames()
      .find((f) => f.url() && f.url().includes('abysscdn.com'));
    if (frame) return frame;
    await delay(500);
  }
  return null;
}

async function resolveHydraxStreamViaPlaywright(iframeUrl) {
  let browser;
  try {
    browser = await getPlaywrightBrowser();
  } catch (err) {
    return null;
  }

  const page = await browser.newPage({
    userAgent: USER_AGENT,
    locale: 'id-ID'
  });
  page.setDefaultTimeout(15000);

  await page.route('**/*', (route) => {
    const type = route.request().resourceType();
    if (type === 'image' || type === 'font' || type === 'stylesheet') {
      return route.abort();
    }
    return route.continue();
  });

  try {
    await page.goto(iframeUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const frame = await waitForAbyssFrame(page, 30000);
    if (!frame) return null;

    await frame.waitForFunction(() => {
      const v = document.querySelector('video');
      return v && (v.currentSrc || v.src || v.getAttribute('src'));
    }, { timeout: 30000 });

    const result = await frame.evaluate(() => {
      const v = document.querySelector('video');
      if (!v) return null;
      return {
        video: v.currentSrc || v.src || v.getAttribute('src') || '',
        poster: v.getAttribute('poster') || ''
      };
    });

    if (!result || !result.video) return null;
    return {
      video: result.video,
      poster: result.poster || null,
      direct: true
    };
  } catch (err) {
    return null;
  } finally {
    await page.close();
  }
}

async function resolveHydraxStream(iframeUrl) {
  const id = extractHydraxId(iframeUrl);
  if (!id) return null;
  const shortUrl = `https://short.icu/${id}`;
  let targetUrl = shortUrl;

  try {
    const res = await fetch(shortUrl, {
      redirect: 'manual',
      headers: {
        'user-agent': USER_AGENT,
        referer: iframeUrl
      }
    });
    const location = res.headers.get('location');
    if (location) targetUrl = location;
  } catch (err) {
    // ignore and keep shortUrl
  }

  const viaPlaywright = await resolveHydraxStreamViaPlaywright(iframeUrl);
  if (viaPlaywright) return viaPlaywright;

  let html;
  try {
    html = await getHtml(targetUrl, {
      usePlaywright: process.env.USE_PLAYWRIGHT === '1',
      useJina: process.env.USE_JINA === '1'
    });
  } catch (err) {
    if (err?.code === 'CLOUDFLARE_BLOCK' && process.env.USE_PLAYWRIGHT !== '1') {
      try {
        html = await getHtml(targetUrl, { usePlaywright: true });
      } catch (err2) {
        return null;
      }
    } else {
      return null;
    }
  }

  if (looksLikeCloudflare(html, 200)) return null;
  const video = findStreamUrl(html);
  if (!video) return null;
  return {
    video,
    poster: findPosterUrl(html),
    referer: targetUrl
  };
}

async function resolveStreamingSource(iframeUrl, refererUrl) {
  if (isHydraxUrl(iframeUrl)) {
    return resolveHydraxStream(iframeUrl);
  }
  const info = await resolvePlayerInfo(iframeUrl);
  if (!info) return null;

  const apiUrl = `${info.apiBase}/api2.php?id=${encodeURIComponent(info.id)}`;
  const apiReferer = `${info.apiBase}/video.php?id=${encodeURIComponent(
    info.id
  )}`;
  const body = new URLSearchParams({
    r: iframeUrl || refererUrl || '',
    d: info.apiHost
  });

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'user-agent': USER_AGENT,
      'content-type': 'application/x-www-form-urlencoded',
      referer: apiReferer
    },
    body: body.toString()
  });

  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  if (!data) return null;

  const file = typeof data === 'string' ? data : data.file;
  if (!file) return null;

  let variants = null;
  try {
    variants = await fetchHlsVariants(file, apiReferer);
  } catch (err) {
    variants = null;
  }

  return {
    video: file,
    variants,
    poster: data.poster || null,
    title: data.title || null,
    referer: apiReferer
  };
}

function buildStreamProxyUrl(url, referer) {
  if (!url) return '';
  const params = new URLSearchParams({ url });
  if (referer) params.set('referer', referer);
  return `/api/stream?${params.toString()}`;
}

function parseHlsAttributes(line) {
  const attrs = {};
  const raw = line.replace(/^#EXT-X-STREAM-INF:/i, '');
  const regex = /([A-Z0-9-]+)=("[^"]*"|[^,]*)/g;
  let match;
  while ((match = regex.exec(raw))) {
    const key = match[1];
    let value = match[2];
    if (value && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1);
    }
    attrs[key] = value;
  }
  return attrs;
}

function buildQualityLabel(attrs) {
  if (!attrs) return 'Stream';
  if (attrs.NAME) return attrs.NAME;
  if (attrs.RESOLUTION) {
    const parts = attrs.RESOLUTION.split('x');
    const height = Number(parts[1]);
    if (Number.isFinite(height)) return `${height}p`;
  }
  if (attrs.BANDWIDTH) {
    const bw = Number(attrs.BANDWIDTH);
    if (Number.isFinite(bw)) return `${Math.round(bw / 1000)}kbps`;
  }
  return 'Stream';
}

function parseHlsVariants(text, baseUrl) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  let pending = null;
  for (const line of lines) {
    if (line.startsWith('#EXT-X-STREAM-INF:')) {
      pending = parseHlsAttributes(line);
      continue;
    }
    if (pending && line && !line.startsWith('#')) {
      let url;
      try {
        url = new URL(line.trim(), baseUrl).toString();
      } catch (err) {
        pending = null;
        continue;
      }
      const label = buildQualityLabel(pending);
      let height = null;
      if (pending.RESOLUTION) {
        const parts = pending.RESOLUTION.split('x');
        const parsedHeight = Number(parts[1]);
        height = Number.isFinite(parsedHeight) ? parsedHeight : null;
      }
      variants.push({
        label,
        url,
        height,
        bandwidth: pending.BANDWIDTH ? Number(pending.BANDWIDTH) : null
      });
      pending = null;
    }
  }

  const seen = new Set();
  return variants.filter((item) => {
    if (!item.url || seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

async function fetchHlsVariants(playlistUrl, referer) {
  if (!playlistUrl || !/\.m3u8($|\\?)/i.test(playlistUrl)) return null;
  const res = await fetch(playlistUrl, {
    headers: {
      'user-agent': USER_AGENT,
      referer
    }
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text.includes('#EXT-X-STREAM-INF')) return null;
  const variants = parseHlsVariants(text, playlistUrl);
  return variants.length ? variants : null;
}

function parseMovieCards(html) {
  const $ = cheerio.load(html);
  const items = [];

  $('article[itemtype="https://schema.org/Movie"]').each((_, el) => {
    const link = $(el).find('a[itemprop="url"]').first().attr('href');
    const url = absoluteUrl(link);
    if (!url) return;

    const title =
      cleanText($(el).find('[itemprop="name"]').first().text()) ||
      cleanText($(el).find('.poster-title').first().text());

    const img =
      $(el).find('img[itemprop="image"]').attr('src') ||
      $(el).find('img').attr('src') ||
      $(el).find('source[type="image/webp"]').attr('srcset') ||
      $(el).find('source[type="image/jpeg"]').attr('srcset') ||
      null;

    const quality =
      cleanText($(el).find('.poster .label').first().text()) ||
      cleanText($(el).find('.poster .quality').first().text()) ||
      null;

    items.push({
      title,
      url: normalizeUrl(url),
      cover: img,
      quality: quality || null
    });
  });

  return dedupeByUrl(items);
}

async function search(query) {
  const q = cleanText(query);
  if (!q) return [];
  const url = `${baseUrl}/search?s=${encodeURIComponent(q)}`;
  const html = await fetchPage(url);
  return parseMovieCards(html);
}

async function getLatest(page = 1) {
  const pageNum = Number(page) || 1;
  let url = `${baseUrl}/top-movie-today`;
  if (pageNum > 1) {
    url = `${baseUrl}/top-movie-today/page/${pageNum}`;
  }
  const html = await fetchPage(url);
  return parseMovieCards(html);
}

async function getManga(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  const $ = cheerio.load(html);

  const metaTitle =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();
  const title = cleanTitle($('.movie-info h1').first().text()) ||
    cleanTitle(metaTitle);

  const cover =
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('.movie-info img').first().attr('src') ||
    null;

  const description =
    cleanText($('.movie-desc').first().text()) ||
    cleanText($('meta[property="og:description"]').attr('content')) ||
    '';

  const genres = [];
  $('.movie-info .tag-list a[href*="/genre/"]').each((_, el) => {
    const text = cleanText($(el).text());
    if (text) genres.push(text);
  });

  const chapters = [
    {
      name: 'Streaming',
      url: target
    }
  ];

  return {
    title: title || cleanTitle(metaTitle) || 'Streaming',
    url: target,
    cover,
    description,
    chapters,
    status: 'Movie',
    author: '-',
    artist: '-',
    type: 'Streaming',
    genres: Array.from(new Set(genres))
  };
}

async function getChapter(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  const $ = cheerio.load(html);
  const candidates = collectPlayerCandidates($);
  const preferredServers = ['hydrax'];
  const hydraxOnly = candidates.filter(
    (item) =>
      (item.server && item.server.includes('hydrax')) || isHydraxUrl(item.url)
  );
  const ordered = sortCandidates(hydraxOnly, preferredServers);
  const fallback = ordered[0] || null;
  const iframe = fallback?.url || null;
  let video;
  let videos;
  let poster;
  let error;

  for (const candidate of ordered) {
    if (!candidate?.url) continue;
    try {
      const resolved = await resolveStreamingSource(candidate.url, target);
      if (resolved?.video) {
        const referer = resolved.referer || target;
        video = resolved.direct
          ? resolved.video
          : buildStreamProxyUrl(resolved.video, referer);
        poster = resolved.poster || null;
        if (Array.isArray(resolved.variants) && resolved.variants.length) {
          videos = resolved.variants.map((item) => ({
            label: item.label,
            url: buildStreamProxyUrl(item.url, referer),
            height: item.height || undefined,
            bandwidth: item.bandwidth || undefined
          }));
        }
        break;
      }
    } catch (err) {
      // coba kandidat berikutnya
    }
  }
  const metaTitle =
    $('meta[property="og:title"]').attr('content') ||
    $('title').text();
  const title = cleanTitle($('.movie-info h1').first().text()) ||
    cleanTitle(metaTitle) ||
    'Streaming';

  if (!video) {
    error =
      'Stream Hydrax diblokir Cloudflare. Instal Playwright (npx playwright install chromium) agar server bisa mengambil video.';
  }

  return {
    title,
    iframe,
    video,
    videos,
    poster,
    openExternal: true,
    error,
    images: [],
    nav: { prev: null, next: null }
  };
}

module.exports = {
  id: 'lk21',
  name: 'LK21 Streaming',
  baseUrl,
  search,
  getLatest,
  getManga,
  getChapter
};
