const cheerio = require('cheerio');
const { getHtml } = require('../lib/http');

const baseUrl = 'https://doujindesu.tv';
const MANGA_URL_RE = /\/manga\/[^/]+\/?$/i;
const JINA_MARKER = 'Markdown Content:';

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

function isJinaContent(text) {
  return Boolean(text && text.startsWith('Title:') && text.includes(JINA_MARKER));
}

function extractJinaMarkdown(text) {
  if (!text) return null;
  const idx = text.indexOf(JINA_MARKER);
  if (idx === -1) return null;
  return text.slice(idx + JINA_MARKER.length).trim();
}

function extractJinaTitle(text) {
  if (!text) return '';
  const match = text.match(/^Title:\s*(.+)$/m);
  return match ? cleanText(match[1]) : '';
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

function parseMangaCards(html) {
  if (isJinaContent(html)) {
    const markdown = extractJinaMarkdown(html) || '';
    return parseMangaCardsFromMarkdown(markdown);
  }

  const $ = cheerio.load(html);
  const items = [];

  $('a[href]').each((_, el) => {
    const href = $(el).attr('href');
    const url = absoluteUrl(href);
    if (!url || !url.startsWith(baseUrl)) return;
    if (!MANGA_URL_RE.test(url)) return;
    if (url.includes('chapter')) return;

    const title =
      cleanText($(el).attr('title')) ||
      cleanText($(el).text()) ||
      cleanText($(el).find('img').attr('alt'));

    const cover = extractCover($(el));

    items.push({
      title,
      url: normalizeUrl(url),
      cover
    });
  });

  return dedupeByUrl(items);
}

function parseMangaCardsFromMarkdown(markdown) {
  const items = [];

  const imageLinkRegex =
    /\[\!\[[^\]]*\]\(([^)]+)\)([^\]]*)\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]+)")?\)/g;
  let match;
  while ((match = imageLinkRegex.exec(markdown))) {
    const cover = match[1];
    const extraText = match[2] || '';
    const url = normalizeUrl(match[3]);
    if (!MANGA_URL_RE.test(url)) continue;
    const title =
      cleanText(match[4] || '') || extractTitleFromText(extraText);
    items.push({ title, url, cover });
  }

  const linkRegex =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]+")?\)/g;
  while ((match = linkRegex.exec(markdown))) {
    const title = cleanText(match[1]);
    const url = normalizeUrl(match[2]);
    if (!MANGA_URL_RE.test(url)) continue;
    items.push({ title, url, cover: null });
  }

  return dedupeByUrl(items);
}

function extractTitleFromText(text) {
  if (!text) return '';
  const hashIndex = text.lastIndexOf('###');
  let value = hashIndex !== -1 ? text.slice(hashIndex + 3) : text;
  value = cleanText(value);
  value = value.replace(/\b(Finished|Ongoing|Completed)\b.*$/i, '').trim();
  value = value.replace(/\b\d+(?:\.\d+)?\b$/, '').trim();
  return value;
}

function parseChapters($, base) {
  const chapters = [];
  const selectors = [
    '.eplister a',
    '.listing-chapters a',
    '.chapter a',
    '.chapters a',
    '.wp-manga-chapter a',
    '.chapter-list a',
    '.chapters-list a',
    '.list-chapter a'
  ];
  let nodes = $(selectors.join(','));
  if (!nodes.length) {
    nodes = $('a[href]');
  }

  nodes.each((_, el) => {
    const href = $(el).attr('href');
    const url = absoluteUrl(href);
    if (!url || !url.startsWith(base)) return;
    if (url.includes('/genre/') || url.includes('/author/')) return;
    if (url.includes('/manga/')) return;
    const name =
      cleanText($(el).text()) || cleanText($(el).attr('title')) || url;
    if (!name) return;
    chapters.push({
      name,
      url: normalizeUrl(url)
    });
  });

  const unique = dedupeByUrl(chapters);
  return unique;
}

function extractImagesFromHtml(html) {
  if (isJinaContent(html)) {
    const markdown = extractJinaMarkdown(html) || '';
    return extractImagesFromMarkdown(markdown);
  }

  const $ = cheerio.load(html);
  const images = [];

  const candidates =
    '#readerarea img, .reading-content img, .read-container img, img.wp-manga-chapter-img';
  $(candidates).each((_, el) => {
    const src =
      $(el).attr('data-src') ||
      $(el).attr('data-lazy-src') ||
      $(el).attr('data-original') ||
      $(el).attr('src');
    if (src) images.push(src);
  });

  if (images.length) {
    return Array.from(new Set(images.map((url) => absoluteUrl(url) || url)));
  }

  const fromScript = new Set();
  const regex = /https?:\/\/[^'"\s]+?\.(?:jpe?g|png|webp)(?:\?[^'"\s]+)?/gi;
  let match;
  while ((match = regex.exec(html))) {
    fromScript.add(match[0]);
  }
  return Array.from(fromScript);
}

function extractImagesFromMarkdown(markdown) {
  const images = [];
  const regex =
    /https?:\/\/[^\s"']+?\.(?:jpe?g|png|webp|gif)(?:\?[^\s"']+)?/gi;
  let match;
  while ((match = regex.exec(markdown))) {
    images.push(match[0]);
  }
  return Array.from(new Set(images));
}

function parseMetadata($) {
  const meta = {};
  $('.post-content_item, .summary-content, .manga-info, .post-content_item').each(
    (_, el) => {
      const heading = cleanText(
        $(el)
          .find('.summary-heading, .summary-heading, h5, h3, b')
          .first()
          .text()
      ).toLowerCase();
      const value = cleanText(
        $(el)
          .find('.summary-content, .summary-content, span, a')
          .first()
          .text()
      );
      if (!heading || !value) return;
      if (heading.includes('status')) meta.status = value;
      if (heading.includes('author')) meta.author = value;
      if (heading.includes('artist')) meta.artist = value;
      if (heading.includes('type')) meta.type = value;
    }
  );

  const genres = [];
  $('.genres-content a, .manga-genres a, .summary-content a').each((_, el) => {
    const text = cleanText($(el).text());
    if (text) genres.push(text);
  });

  meta.genres = Array.from(new Set(genres));
  return meta;
}

function parseMetadataFromMarkdown(markdown) {
  const meta = { genres: [] };
  const lines = markdown.split(/\r?\n/).map((line) => line.trim());
  const metaRegex = /^(Status|Type|Author|Artist)\s*\[([^\]]+)\]/i;
  for (const line of lines) {
    const match = line.match(metaRegex);
    if (match) {
      const key = match[1].toLowerCase();
      const value = cleanText(match[2]);
      if (key === 'status') meta.status = value;
      if (key === 'type') meta.type = value;
      if (key === 'author') meta.author = value;
      if (key === 'artist') meta.artist = value;
    }
  }

  const genreRegex =
    /\[([^\]]+)\]\((https?:\/\/[^)\s]+\/genre\/[^)\s]+)(?:\s+"[^"]+")?\)/gi;
  let match;
  while ((match = genreRegex.exec(markdown))) {
    meta.genres.push(cleanText(match[1]));
  }
  meta.genres = Array.from(new Set(meta.genres));

  meta.description = extractDescriptionFromMarkdown(lines);
  return meta;
}

function extractDescriptionFromMarkdown(lines) {
  const markers = ['sinopsis', 'synopsis', 'summary', 'deskripsi'];
  let capture = false;
  const buff = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (markers.some((m) => line.toLowerCase().startsWith(m))) {
      capture = true;
      continue;
    }
    if (capture) {
      if (line.startsWith('#') || /daftar chapter/i.test(line)) break;
      if (line.startsWith('---')) break;
      buff.push(line);
    }
  }
  return cleanText(buff.join(' '));
}

function pickCoverFromMarkdown(markdown) {
  const regex = /!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g;
  let match;
  let fallback = null;
  while ((match = regex.exec(markdown))) {
    const url = match[1];
    if (isAdUrl(url)) continue;
    if (url.includes('cdn.doujindesu.dev/uploads')) return url;
    if (!fallback) fallback = url;
  }
  return fallback;
}

function isAdUrl(url) {
  if (!url) return true;
  const lower = url.toLowerCase();
  const adHosts = [
    'blogger.googleusercontent.com',
    'sstatic1.histats.com'
  ];
  const adHints = [
    'doubleclick',
    'googlesyndication',
    'adsystem',
    'adservice',
    'banner',
    'histats',
    'popads',
    'click',
    'gacor',
    'sbobet',
    'slot',
    'casino',
    'promo',
    'sponsor',
    'tracking'
  ];
  if (lower.includes('logo-doujindesu')) return true;
  if (adHosts.some((host) => lower.includes(host))) return true;
  if (adHints.some((hint) => lower.includes(hint))) return true;
  return false;
}

function mostCommonPrefix(urls) {
  const counts = new Map();
  for (const url of urls) {
    try {
      const u = new URL(url);
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length < 2) continue;
      const prefix = `${u.origin}/${parts.slice(0, -1).join('/')}/`;
      counts.set(prefix, (counts.get(prefix) || 0) + 1);
    } catch (err) {
      // ignore invalid
    }
  }
  let best = null;
  for (const [prefix, count] of counts.entries()) {
    if (!best || count > best.count) best = { prefix, count };
  }
  return best;
}

function filterChapterImages(images) {
  if (!images || !images.length) return [];
  const deduped = Array.from(new Set(images));

  // Drop obvious ad/tracking URLs first.
  const withoutAds = deduped.filter((url) => !isAdUrl(url));
  const candidates = withoutAds.length ? withoutAds : deduped;

  // Prefer storage uploads or wp-content uploads if present.
  const storage = candidates.filter((url) =>
    /\/storage\/uploads\/|\/wp-content\/uploads\//i.test(url)
  );
  if (storage.length >= 3) return storage;

  // Prefer known content domains.
  const preferredDomains = candidates.filter(
    (url) =>
      url.includes('desu.photos') ||
      url.includes('cdn.doujindesu.dev') ||
      url.includes('doujindesu.tv')
  );
  const domainPool = preferredDomains.length ? preferredDomains : candidates;

  // Try to group by common prefix directory (chapter folder).
  const best = mostCommonPrefix(domainPool);
  if (best && best.count >= 3) {
    const grouped = domainPool.filter((url) => url.startsWith(best.prefix));
    if (grouped.length >= 3) return grouped;
  }

  // If ads are still likely (.gif), drop gifs when there are non-gif images.
  const nonGif = domainPool.filter((url) => !/\.gif(\?|$)/i.test(url));
  if (nonGif.length) return nonGif;

  return domainPool;
}

function deriveChapterUrl(mangaUrl) {
  if (!mangaUrl) return null;
  try {
    const parsed = new URL(mangaUrl);
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (!parts.length) return null;
    const slug = parts[parts.length - 1];
    return `${parsed.origin}/${slug}/`;
  } catch (err) {
    return null;
  }
}

function parseChaptersFromMarkdown(markdown) {
  const chapters = [];
  const lines = markdown.split(/\r?\n/);
  let inSection = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (/daftar chapter/i.test(line)) {
      inSection = true;
      continue;
    }
    if (!inSection) continue;
    if (line.startsWith('#') || /you may also like/i.test(line)) break;
    if (/komentar/i.test(line)) break;

    const link = extractFirstMarkdownLink(line);
    if (!link) continue;
    if (link.url.includes('/genre/') || link.url.includes('/author/')) continue;
    if (link.url.includes('/manga/')) continue;

    const name = cleanText(link.title || link.text || '');
    chapters.push({
      name: name || link.url,
      url: normalizeUrl(link.url)
    });
  }
  return dedupeByUrl(chapters);
}

function extractFirstMarkdownLink(line) {
  const regex = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"([^"]+)")?\)/;
  const match = line.match(regex);
  if (!match) return null;
  return {
    text: match[1],
    url: match[2],
    title: match[3]
  };
}

function parseNavFromMarkdown(markdown) {
  const nav = { prev: null, next: null };
  const linkRegex =
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)(?:\s+"[^"]+")?\)/g;
  let match;
  while ((match = linkRegex.exec(markdown))) {
    const label = match[1].toLowerCase();
    if (!nav.prev && /prev|previous/.test(label)) {
      nav.prev = normalizeUrl(match[2]);
    }
    if (!nav.next && /next/.test(label)) {
      nav.next = normalizeUrl(match[2]);
    }
  }
  return nav;
}

async function fetchPage(url) {
  return getHtml(url, {
    usePlaywright: process.env.USE_PLAYWRIGHT === '1',
    useJina: process.env.USE_JINA === '1',
    autoJina: true
  });
}

async function search(query) {
  const q = cleanText(query);
  if (!q) return [];
  const url = `${baseUrl}/?s=${encodeURIComponent(q)}&post_type=wp-manga`;
  const html = await fetchPage(url);
  return parseMangaCards(html);
}

async function getLatest(page = 1, type = '') {
  const pageNum = Number(page) || 1;
  let url = `${baseUrl}/manga/`;
  if (pageNum > 1) {
    if (process.env.USE_JINA === '1') {
      url = `${baseUrl}/page/${pageNum}/?post_type=wp-manga`;
    } else {
      url = `${baseUrl}/manga/page/${pageNum}/`;
    }
  } else if (process.env.USE_JINA === '1') {
    url = `${baseUrl}/?post_type=wp-manga`;
  }
  if (type) {
    const joiner = url.includes('?') ? '&' : '?';
    url = `${url}${joiner}type=${encodeURIComponent(type)}`;
  }
  const html = await fetchPage(url);
  return parseMangaCards(html);
}

async function getManga(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  if (isJinaContent(html)) {
    const markdown = extractJinaMarkdown(html) || '';
    const meta = parseMetadataFromMarkdown(markdown);
    let cover = pickCoverFromMarkdown(markdown);
    let chapters = parseChaptersFromMarkdown(markdown);
    let fallbackChapterData = null;

    if (!chapters.length) {
      const fallbackUrl = deriveChapterUrl(target);
      if (fallbackUrl) {
        const chapterData = await getChapter(fallbackUrl);
        fallbackChapterData = chapterData;
        if (chapterData.images && chapterData.images.length) {
          chapters = [
            {
              name: 'Chapter 1',
              url: normalizeUrl(fallbackUrl)
            }
          ];
          if (!cover) {
            cover = chapterData.images[0];
          }
        }
      }
    }

    if (cover && isAdUrl(cover) && fallbackChapterData?.images?.length) {
      cover = fallbackChapterData.images[0];
    }

    return {
      title: extractJinaTitle(html),
      url: target,
      cover,
      description: meta.description || '',
      chapters,
      status: meta.status,
      author: meta.author,
      artist: meta.artist,
      type: meta.type,
      genres: meta.genres
    };
  }

  const $ = cheerio.load(html);

  const title =
    cleanText($('h1').first().text()) ||
    cleanText($('title').first().text().split('|')[0]);

  const cover =
    $('.summary_image img').attr('data-src') ||
    $('.summary_image img').attr('src') ||
    $('.post-thumbnail img').attr('data-src') ||
    $('.post-thumbnail img').attr('src') ||
    $('meta[property="og:image"]').attr('content') ||
    null;

  const description =
    cleanText($('.summary__content').text()) ||
    cleanText($('.manga-excerpt').text()) ||
    cleanText($('.entry-content').text());

  const meta = parseMetadata($);
  let chapters = parseChapters($, baseUrl);
  let coverCandidate = cover;

  if (!chapters.length) {
    const fallbackUrl = deriveChapterUrl(target);
    if (fallbackUrl) {
      const chapterData = await getChapter(fallbackUrl);
      if (chapterData.images && chapterData.images.length) {
        chapters = [
          {
            name: 'Chapter 1',
            url: normalizeUrl(fallbackUrl)
          }
        ];
        if (!coverCandidate) coverCandidate = chapterData.images[0];
      }
    }
  }

  return {
    title,
    url: target,
    cover: coverCandidate,
    description,
    chapters,
    ...meta
  };
}

async function getChapter(url) {
  const target = normalizeUrl(url);
  const html = await fetchPage(target);
  if (isJinaContent(html)) {
    const markdown = extractJinaMarkdown(html) || '';
    return {
      title: extractJinaTitle(html),
      url: target,
      images: filterChapterImages(extractImagesFromMarkdown(markdown)),
      nav: parseNavFromMarkdown(markdown)
    };
  }

  const $ = cheerio.load(html);

  const title =
    cleanText($('h1').first().text()) ||
    cleanText($('.entry-title').first().text()) ||
    cleanText($('title').first().text());

  const images = filterChapterImages(extractImagesFromHtml(html));

  const nav = {
    prev: null,
    next: null
  };
  const prevLink = $('a.prev_page, a.prev, a.chapter-prev').attr('href');
  const nextLink = $('a.next_page, a.next, a.chapter-next').attr('href');
  if (prevLink) nav.prev = normalizeUrl(absoluteUrl(prevLink));
  if (nextLink) nav.next = normalizeUrl(absoluteUrl(nextLink));

  return {
    title,
    url: target,
    images,
    nav
  };
}

module.exports = {
  id: 'doujindesu',
  name: 'Doujindesu',
  baseUrl,
  normalizeUrl,
  search,
  getLatest,
  getManga,
  getChapter
};
