const cheerio = require('cheerio');
const { getHtml, looksLikeCloudflare } = require('../lib/http');

const baseUrl = 'https://v14.kuramanime.tel';
const EPISODE_RE = /\/episode\/\d+/i;

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
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url) {
  if (!url) return url;
  const normalized = url.split('#')[0].split('?')[0];
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
}

function isEpisodeUrl(url) {
  return EPISODE_RE.test(url || '');
}

function stripEpisodeUrl(url) {
  if (!url) return url;
  return normalizeUrl(url).replace(/\/episode\/\d+\/?$/i, '/');
}

function extractEpisodeNumber(value) {
  if (!value) return null;
  const match = String(value).match(/episode\s*(\d+)|\bep\s*(\d+)/i);
  const num = match ? match[1] || match[2] : null;
  return num ? Number(num) : null;
}

function extractEpisodeLabel(text, url) {
  const fromText = extractEpisodeNumber(text);
  if (fromText) return `Ep ${fromText}`;
  const fromUrl = extractEpisodeNumber(url);
  if (fromUrl) return `Ep ${fromUrl}`;
  return null;
}

function toTitleCase(value) {
  if (!value) return '';
  return String(value).replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function titleFromSlug(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    let slug = parts[parts.length - 1] || '';
    if (/^\d+$/.test(slug) && parts.length > 1) {
      slug = parts[parts.length - 2] || slug;
    }
    const decoded = decodeURIComponent(slug);
    const cleaned = cleanText(decoded.replace(/[-_]+/g, ' '));
    return toTitleCase(cleaned);
  } catch (err) {
    return '';
  }
}

function extractTitleFromEpisodeText(text) {
  if (!text) return '';
  let value = cleanText(text);
  value = value.replace(/^ep\s*\d+[^a-z0-9]+/i, '');
  value = value.replace(/\b(ep|episode)\s*\d+.*$/i, '');
  value = value.replace(/\bhd\b|\bsub\b|\bsubtitled\b|\bindo\b|\bselesai\b/gi, '');
  return cleanText(value);
}

function isGenericTitle(value) {
  if (!value) return true;
  const lower = value.toLowerCase();
  if (lower === 'anime') return true;
  if (lower === 'episode') return true;
  if (lower === 'ongoing') return true;
  if (lower.includes('kuramanime')) return true;
  if (lower.includes('just a moment')) return true;
  if (lower.includes('tunggu sebentar')) return true;
  if (lower.includes('verifikasi keamanan')) return true;
  if (lower.includes('cloudflare')) return true;
  return false;
}

function pickTitle(candidates, fallback) {
  for (const raw of candidates) {
    const cleaned = cleanText(raw);
    if (!cleaned) continue;
    if (isGenericTitle(cleaned)) continue;
    return cleaned;
  }
  return fallback || '';
}

function decodeEscapedSlashes(html) {
  if (!html) return '';
  return html.replace(/\\u002F/gi, '/').replace(/\\\//g, '/');
}

function extractUrlsFromHtml(html, token) {
  if (!html) return [];
  const normalized = decodeEscapedSlashes(html);
  const urls = new Set();
  const absRegex = new RegExp(`https?:\\/\\/[^"'\\s]+${token}[^"'\\s]+`, 'gi');
  const relRegex = new RegExp(`${token}[^"'\\s]+`, 'gi');
  let match;
  while ((match = absRegex.exec(normalized))) {
    urls.add(match[0]);
  }
  while ((match = relRegex.exec(normalized))) {
    const raw = match[0];
    if (raw.startsWith('http')) {
      urls.add(raw);
      continue;
    }
    try {
      urls.add(new URL(raw, baseUrl).toString());
    } catch (err) {
      // ignore invalid urls
    }
  }
  return Array.from(urls);
}

function findLinkUrl($el) {
  return (
    $el.attr('href') ||
    $el.attr('data-href') ||
    $el.attr('data-url') ||
    $el.attr('data-link') ||
    $el.attr('data-episode') ||
    $el.find('a[href]').first().attr('href') ||
    $el.find('[data-href]').first().attr('data-href') ||
    $el.find('[data-url]').first().attr('data-url') ||
    $el.find('[data-link]').first().attr('data-link') ||
    null
  );
}

function extractTitleFromElement($el, url) {
  const candidates = [
    $el.attr('data-title'),
    $el.attr('data-name'),
    $el.attr('data-anime'),
    $el.attr('data-series'),
    $el.attr('aria-label'),
    $el.attr('title'),
    $el.find('[data-title]').first().attr('data-title'),
    $el.find('[data-name]').first().attr('data-name'),
    $el.find('.title, .name, .series, .anime-title, .title-name, .entry-title')
      .first()
      .text(),
    $el.find('h1, h2, h3, h4').first().text(),
    $el.find('img').first().attr('alt'),
    $el.find('img').first().attr('title'),
    $el.text()
  ];
  return pickTitle(candidates, titleFromSlug(url));
}

function extractCoverFromElement($el) {
  const img = $el.find('img').first();
  if (!img.length) return null;
  return (
    img.attr('data-src') ||
    img.attr('data-lazy-src') ||
    img.attr('data-original') ||
    img.attr('src') ||
    null
  );
}

function isBlockedHtml(html) {
  if (!html) return true;
  if (looksLikeCloudflare(html, 403)) return true;
  const lower = html.toLowerCase();
  return (
    lower.includes('cf-chl') ||
    lower.includes('turnstile') ||
    lower.includes('just a moment') ||
    lower.includes('tunggu sebentar') ||
    lower.includes('verifikasi keamanan') ||
    lower.includes('cloudflare')
  );
}

function getKuramaHeaders() {
  const headers = {};
  const cookie =
    process.env.KURAMA_COOKIE ||
    process.env.KURAMANIME_COOKIE ||
    process.env.CF_COOKIE ||
    '';
  if (cookie) headers.cookie = cookie;
  return headers;
}

function dedupeByUrl(items) {
  const seen = new Map();
  for (const item of items) {
    if (!item.url) continue;
    const key = item.url;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
      continue;
    }
    if (!existing.title && item.title) existing.title = item.title;
    if (!existing.cover && item.cover) existing.cover = item.cover;
    if (!existing.latestChapter && item.latestChapter) {
      existing.latestChapter = item.latestChapter;
    }
  }
  return Array.from(seen.values());
}

function parseEpisodeLinks(html, animeUrl) {
  const $ = cheerio.load(html || '');
  const items = [];
  const base = animeUrl ? normalizeUrl(animeUrl) : baseUrl;

  const selectors = [
    'a[href*="/episode/"]',
    '[data-href*="/episode/"]',
    '[data-url*="/episode/"]',
    '[data-link*="/episode/"]'
  ];

  $(selectors.join(',')).each((_, el) => {
    const $el = $(el);
    const href = findLinkUrl($el);
    const url = absoluteUrl(href);
    if (!url) return;
    if (!url.includes('/episode/')) return;
    if (animeUrl && !url.startsWith(base)) return;
    const container = $el.closest('.item, .card, .post, li, .episode, .anime');
    const text = cleanText($el.text()) || cleanText(container.text());
    const label = extractEpisodeLabel(text, url);
    items.push({
      name: label || cleanText(text) || url,
      url: normalizeUrl(url)
    });
  });

  let results = dedupeByUrl(items);
  if (!results.length) {
    const urls = extractUrlsFromHtml(html, '/episode/');
    results = urls
      .filter((url) => !animeUrl || url.startsWith(base))
      .map((url) => ({
        name: extractEpisodeLabel(url, url) || titleFromSlug(url) || url,
        url: normalizeUrl(url)
      }));
    results = dedupeByUrl(results);
  }
  return results;
}

function parseAnimeList(html) {
  const $ = cheerio.load(html || '');
  const items = [];

  const selectors = [
    'a[href*="/anime/"]',
    '[data-href*="/anime/"]',
    '[data-url*="/anime/"]',
    '[data-link*="/anime/"]'
  ];

  $(selectors.join(',')).each((_, el) => {
    const $el = $(el);
    const href = findLinkUrl($el);
    const url = absoluteUrl(href);
    if (!url) return;
    if (isEpisodeUrl(url)) return;
    if (!url.includes('/anime/')) return;
    const container = $el.closest('.item, .card, .post, li, .anime, .entry');
    const title = extractTitleFromElement(container.length ? container : $el, url);
    const cover = extractCoverFromElement(container.length ? container : $el);
    if (!title) return;
    items.push({
      title,
      url: normalizeUrl(url),
      cover: cover || null
    });
  });

  let results = dedupeByUrl(items);
  if (!results.length) {
    const urls = extractUrlsFromHtml(html, '/anime/');
    results = urls
      .filter((url) => !isEpisodeUrl(url))
      .map((url) => ({
        title: titleFromSlug(url),
        url: normalizeUrl(url),
        cover: null
      }));
    results = dedupeByUrl(results);
  }
  return results;
}

function parseLatestFromEpisodes(html) {
  const $ = cheerio.load(html || '');
  const items = [];

  const selectors = [
    'a[href*="/episode/"]',
    '[data-href*="/episode/"]',
    '[data-url*="/episode/"]',
    '[data-link*="/episode/"]'
  ];

  $(selectors.join(',')).each((_, el) => {
    const $el = $(el);
    const href = findLinkUrl($el);
    const episodeUrl = absoluteUrl(href);
    if (!episodeUrl) return;
    if (!episodeUrl.includes('/episode/')) return;
    const animeUrl = stripEpisodeUrl(episodeUrl);
    const container = $el.closest('.item, .card, .post, li, .episode, .anime');
    const rawText =
      cleanText($el.text()) ||
      cleanText(container.text()) ||
      cleanText($el.attr('title'));
    const extracted = extractTitleFromEpisodeText(rawText);
    const title = pickTitle([extracted, rawText], titleFromSlug(animeUrl));
    const latestChapter = extractEpisodeLabel(rawText, episodeUrl);
    const cover = extractCoverFromElement(container.length ? container : $el);
    items.push({
      title,
      url: normalizeUrl(animeUrl),
      cover: cover || null,
      latestChapter
    });
  });

  let results = dedupeByUrl(items);
  if (!results.length) {
    const urls = extractUrlsFromHtml(html, '/episode/');
    results = urls.map((episodeUrl) => {
      const animeUrl = stripEpisodeUrl(episodeUrl);
      const latestChapter = extractEpisodeLabel(episodeUrl, episodeUrl);
      return {
        title: titleFromSlug(animeUrl),
        url: normalizeUrl(animeUrl),
        cover: null,
        latestChapter
      };
    });
    results = dedupeByUrl(results);
  }
  return results;
}

function extractMetaFromText(text) {
  const meta = {};
  if (!text) return meta;
  const pick = (label) => {
    const regex = new RegExp(`${label}\\s*:?\\s*([^\\n\\r]+)`, 'i');
    const match = text.match(regex);
    return match ? cleanText(match[1]) : '';
  };
  meta.status = pick('Status');
  meta.type = pick('Tipe|Type');
  return meta;
}

function extractDescription($) {
  const desc =
    cleanText($('.synopsis, .sinopsis, .description, .summary').first().text()) ||
    cleanText($('.entry-content, .post-content').first().text());
  if (desc) return desc;
  const metaDesc =
    $('meta[property="og:description"]').attr('content') ||
    $('meta[name="description"]').attr('content') ||
    '';
  return cleanText(metaDesc);
}

function extractCover($) {
  return (
    $('meta[property="og:image"]').attr('content') ||
    $('meta[name="twitter:image"]').attr('content') ||
    $('.poster img').attr('src') ||
    $('.poster img').attr('data-src') ||
    $('.cover img').attr('src') ||
    $('.cover img').attr('data-src') ||
    $('img').first().attr('src') ||
    null
  );
}

function extractGenres($) {
  const genres = [];
  $('a[href*="/genre/"]').each((_, el) => {
    const text = cleanText($(el).text());
    if (text) genres.push(text);
  });
  return Array.from(new Set(genres));
}

async function fetchPage(url) {
  const html = await getHtml(url, {
    usePlaywright: process.env.USE_PLAYWRIGHT === '1',
    useJina: process.env.USE_JINA === '1',
    autoPlaywright: true,
    autoJina: true,
    headers: getKuramaHeaders()
  });
  if (isBlockedHtml(html)) {
    const error = new Error(
      'Kuramanime diblokir Cloudflare. Jalankan USE_PLAYWRIGHT=1 dan/atau set KURAMA_COOKIE dari browser.'
    );
    error.code = 'CLOUDFLARE_BLOCK';
    throw error;
  }
  return html;
}

async function search(query) {
  const q = cleanText(query);
  if (!q) return [];

  const listUrl = `${baseUrl}/anime?order_by=text`;
  const html = await fetchPage(listUrl);
  let items = parseAnimeList(html);

  let results = items.filter((item) =>
    item.title.toLowerCase().includes(q.toLowerCase())
  );

  if (results.length >= 8) return results;

  const $ = cheerio.load(html || '');
  const pageLinks = [];
  $('a[href*="page="], a[href*="/page/"]').each((_, el) => {
    const href = absoluteUrl($(el).attr('href'));
    if (!href) return;
    if (!href.includes('/anime')) return;
    pageLinks.push(href);
  });
  const uniquePages = Array.from(new Set(pageLinks)).slice(0, 2);
  for (const pageUrl of uniquePages) {
    const pageHtml = await fetchPage(pageUrl);
    const pageItems = parseAnimeList(pageHtml);
    const filtered = pageItems.filter((item) =>
      item.title.toLowerCase().includes(q.toLowerCase())
    );
    results = dedupeByUrl(results.concat(filtered));
    if (results.length >= 12) break;
  }

  return results;
}

async function getLatest(page = 1) {
  const pageNum = Number(page) || 1;
  const candidates = [];
  if (pageNum > 1) {
    candidates.push(`${baseUrl}/ongoing/page/${pageNum}/`);
    candidates.push(`${baseUrl}/quick/ongoing/page/${pageNum}/`);
  }
  candidates.push(`${baseUrl}/ongoing/`);
  candidates.push(`${baseUrl}/quick/ongoing/`);

  for (const url of candidates) {
    try {
      const html = await fetchPage(url);
      const items = parseLatestFromEpisodes(html);
      if (items.length) return items;
    } catch (err) {
      // coba kandidat berikutnya
    }
  }
  return [];
}

async function getManga(url) {
  const input = normalizeUrl(url);
  const animeUrl = isEpisodeUrl(input) ? stripEpisodeUrl(input) : input;
  const html = await fetchPage(animeUrl);
  const $ = cheerio.load(html || '');

  const title = pickTitle(
    [
      $('h1').first().text(),
      $('meta[property="og:title"]').attr('content'),
      $('title').first().text()
    ],
    titleFromSlug(animeUrl)
  );

  const cover = extractCover($);
  const description = extractDescription($);
  const meta = extractMetaFromText(cleanText($('body').text()));

  let chapters = parseEpisodeLinks(html, animeUrl);

  if (!chapters.length) {
    const episodeUrl = `${animeUrl.replace(/\/$/, '')}/episode/1/`;
    try {
      const episodeHtml = await fetchPage(episodeUrl);
      chapters = parseEpisodeLinks(episodeHtml, animeUrl);
    } catch (err) {
      chapters = [];
    }
  }

  return {
    title: title || 'Anime',
    url: animeUrl,
    cover,
    description,
    chapters,
    status: meta.status || 'Available',
    author: '-',
    artist: '-',
    type: meta.type || 'Streaming',
    genres: extractGenres($)
  };
}

function findIframeUrl($, html) {
  const iframe =
    $('iframe[src]').first().attr('src') ||
    $('iframe[data-src]').first().attr('data-src') ||
    $('iframe[data-lazy-src]').first().attr('data-lazy-src') ||
    null;
  if (iframe) return iframe;
  if (!html) return null;
  const match =
    html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
    html.match(/data-(?:src|embed|player|link|url)=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function findVideoUrl($, html) {
  const direct =
    $('video source[src]').first().attr('src') ||
    $('video').first().attr('src') ||
    $('video').first().attr('data-src') ||
    null;
  if (direct) return direct;
  if (!html) return null;
  const match =
    html.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/i) ||
    html.match(/https?:\/\/[^'"\s]+\.mp4[^'"\s]*/i);
  return match ? match[0] : null;
}

async function getChapter(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  const $ = cheerio.load(html || '');

  const title = pickTitle(
    [
      $('h1').first().text(),
      $('meta[property="og:title"]').attr('content'),
      $('title').first().text()
    ],
    titleFromSlug(target) || 'Streaming'
  );

  let iframe = findIframeUrl($, html);
  let video = findVideoUrl($, html);
  let poster =
    $('meta[property="og:image"]').attr('content') ||
    $('video').attr('poster') ||
    null;

  if (iframe) iframe = absoluteUrl(iframe);
  if (video) video = absoluteUrl(video);
  if (poster) poster = absoluteUrl(poster);

  let error;
  let openExternal;

  if (!iframe && !video) {
    error =
      'Streaming tidak ditemukan. Coba aktifkan USE_PLAYWRIGHT=1 atau buka player eksternal.';
    openExternal = true;
    iframe = target;
  }

  return {
    title,
    iframe: iframe || null,
    video: video || undefined,
    poster: poster || null,
    openExternal,
    error,
    images: [],
    nav: { prev: null, next: null }
  };
}

module.exports = {
  id: 'kuramanime',
  name: 'Kuramanime',
  baseUrl,
  search,
  getLatest,
  getManga,
  getChapter
};
