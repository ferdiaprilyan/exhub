const cheerio = require('cheerio');
const { getHtml } = require('../lib/http');

const baseUrl = 'https://tv12.idlixku.com';

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

function titleFromUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return '';
    let slug = parts[parts.length - 1];
    slug = decodeURIComponent(slug);
    slug = slug.replace(/[-_]+/g, ' ').trim();
    if (!slug) return '';
    return slug.replace(/\b\w/g, (ch) => ch.toUpperCase());
  } catch (err) {
    return '';
  }
}

function isGenericTitle(title) {
  if (!title) return true;
  const lower = title.toLowerCase();
  if (lower.includes('idlix')) return true;
  if (lower.includes('nonton film')) return true;
  if (lower.includes('subtitle indonesia')) return true;
  return false;
}

function isNonContentUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  if (lower.includes('/genre/')) return true;
  if (lower.includes('/tag/')) return true;
  if (lower.includes('/category/')) return true;
  if (lower.includes('/wp-content/')) return true;
  if (lower.includes('/wp-json/')) return true;
  return false;
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
  }
  return Array.from(seen.values());
}

function extractCover($el) {
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

async function fetchPage(url) {
  return getHtml(url, {
    usePlaywright: process.env.USE_PLAYWRIGHT === '1',
    useJina: process.env.USE_JINA === '1',
    autoPlaywright: true
  });
}

function parseCards(html) {
  const $ = cheerio.load(html);
  const items = [];

  const containers = $('article, .items .item, .items article, .item');
  containers.each((_, el) => {
    const link =
      $(el).find('a[href]').first().attr('href') || $(el).attr('href');
    const url = absoluteUrl(link);
    if (!url || isNonContentUrl(url)) return;

    let title =
      cleanText($(el).find('h1, h2, h3, h4, .title, .data h3').first().text()) ||
      cleanText($(el).find('a[title]').first().attr('title')) ||
      cleanText($(el).find('img').first().attr('alt')) ||
      cleanText($(el).text());
    if (!title) title = titleFromUrl(url);

    const cover = extractCover($(el));

    items.push({
      title,
      url: normalizeUrl(url),
      cover
    });
  });

  if (items.length) return dedupeByUrl(items);

  $('a[href]').each((_, el) => {
    const url = absoluteUrl($(el).attr('href'));
    if (!url || isNonContentUrl(url)) return;
    if (!url.startsWith(baseUrl)) return;
    let title =
      cleanText($(el).attr('title')) ||
      cleanText($(el).text()) ||
      cleanText($(el).find('img').attr('alt'));
    if (!title) title = titleFromUrl(url);
    if (!title) return;
    items.push({
      title,
      url: normalizeUrl(url),
      cover: extractCover($(el))
    });
  });

  return dedupeByUrl(items);
}

function parseChapters($) {
  const chapters = [];
  const selectors = [
    '.se-c .se-a a',
    '.se-c .se-a ul li a',
    '.seasons .se-c a',
    '.episodios a',
    '.episodes a',
    '.listing a',
    '.chapter-list a',
    '.chapters a'
  ];
  let nodes = $(selectors.join(','));
  if (!nodes.length) {
    nodes = $('a[href]');
  }

  nodes.each((_, el) => {
    const href = $(el).attr('href');
    const url = absoluteUrl(href);
    if (!url || !url.startsWith(baseUrl)) return;
    if (isNonContentUrl(url)) return;
    let name =
      cleanText($(el).text()) || cleanText($(el).attr('title'));
    if (!name) name = titleFromUrl(url) || url;
    if (!name) return;
    chapters.push({
      name,
      url: normalizeUrl(url)
    });
  });

  return dedupeByUrl(chapters);
}

function parsePlayerUrl($) {
  const iframe =
    $('iframe[src]').first().attr('src') ||
    $('iframe[data-src]').first().attr('data-src') ||
    $('iframe[data-lazy-src]').first().attr('data-lazy-src') ||
    $('#player iframe[src]').attr('src') ||
    $('.player iframe[src]').attr('src') ||
    null;
  if (iframe) return iframe;

  let picked = null;
  $('#playeroptions li, .playeroptions li, .dooplay_player_option, .player li').each(
    (_, el) => {
      if (picked) return;
      const $el = $(el);
      const candidate =
        $el.attr('data-src') ||
        $el.attr('data-embed') ||
        $el.attr('data-player') ||
        $el.attr('data-link') ||
        $el.attr('data-url') ||
        $el.find('[data-src]').attr('data-src') ||
        $el.find('[data-embed]').attr('data-embed');
      if (candidate) picked = candidate;
    }
  );
  return picked;
}

function parseVideoUrl($) {
  const source =
    $('video source[src]').first().attr('src') ||
    $('video').first().attr('src') ||
    $('video').first().attr('data-src') ||
    null;
  return source;
}

function findIframeUrlFromHtml(html) {
  if (!html) return null;
  const match =
    html.match(/<iframe[^>]+src=["']([^"']+)["']/i) ||
    html.match(/data-(?:src|embed|player|link|url)=["']([^"']+)["']/i);
  return match ? match[1] : null;
}

function findStreamUrlFromHtml(html) {
  if (!html) return null;
  const direct =
    html.match(/https?:\/\/[^'"\s]+\.m3u8[^'"\s]*/i) ||
    html.match(/https?:\/\/[^'"\s]+\.mp4[^'"\s]*/i);
  if (direct) return direct[0];

  const fileMatch = html.match(
    /file\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/i
  );
  if (fileMatch) return fileMatch[1];

  const sourceMatch = html.match(
    /source\s*[:=]\s*\[\s*\{\s*file\s*[:=]\s*["'](https?:\/\/[^"'\s]+)["']/i
  );
  if (sourceMatch) return sourceMatch[1];

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

async function search(query) {
  const q = cleanText(query);
  if (!q) return [];
  const url = `${baseUrl}/?s=${encodeURIComponent(q)}`;
  const html = await fetchPage(url);
  return parseCards(html);
}

async function getLatest(page = 1) {
  const pageNum = Number(page) || 1;
  const url = pageNum > 1 ? `${baseUrl}/page/${pageNum}/` : `${baseUrl}/`;
  const html = await fetchPage(url);
  return parseCards(html);
}

async function getManga(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  const $ = cheerio.load(html);

  let title =
    cleanText($('h1').first().text()) ||
    cleanText($('meta[property=\"og:title\"]').attr('content')) ||
    cleanText($('title').first().text());
  if (!title || isGenericTitle(title)) title = titleFromUrl(target);

  const cover =
    $('.poster img').attr('src') ||
    $('.poster img').attr('data-src') ||
    $('.data .poster img').attr('src') ||
    $('.data .poster img').attr('data-src') ||
    $('meta[property=\"og:image\"]').attr('content') ||
    null;

  const description =
    cleanText($('.wp-content').first().text()) ||
    cleanText($('.sbox .wp-content').first().text()) ||
    cleanText($('.synopsis, .resum, .description').first().text()) ||
    '';

  const genres = [];
  $('.sgeneros a, .genres a, .sgeneros a').each((_, el) => {
    const text = cleanText($(el).text());
    if (text) genres.push(text);
  });

  let chapters = parseChapters($);
  if (!chapters.length) {
    chapters = [
      {
        name: 'Streaming',
        url: target
      }
    ];
  }

  return {
    title: title || 'Streaming',
    url: target,
    cover,
    description,
    chapters,
    status: 'Available',
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

  let title =
    cleanText($('h1').first().text()) ||
    cleanText($('meta[property=\"og:title\"]').attr('content')) ||
    cleanText($('title').first().text());
  if (!title || isGenericTitle(title)) {
    title = titleFromUrl(target) || 'Streaming';
  }

  let iframe = parsePlayerUrl($);
  let video = parseVideoUrl($);
  if (!iframe) {
    const fallbackIframe = findIframeUrlFromHtml(html);
    if (fallbackIframe) iframe = fallbackIframe;
  }
  if (!video) {
    const fallbackVideo = findStreamUrlFromHtml(html);
    if (fallbackVideo) video = fallbackVideo;
  }
  let error;
  if (!iframe && !video) {
    error =
      'Streaming tidak ditemukan. Coba buka halaman sumber atau aktifkan USE_PLAYWRIGHT=1.';
  }

  return {
    title,
    iframe: iframe || null,
    video: video || undefined,
    error,
    images: [],
    nav: { prev: null, next: null }
  };
}

module.exports = {
  id: 'idlixku',
  name: 'IDLIXKU',
  baseUrl,
  search,
  getLatest,
  getManga,
  getChapter
};
