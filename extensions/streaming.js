const fs = require('node:fs');
const path = require('node:path');

const baseUrl = 'local://streaming';
const dataPath = path.join(__dirname, '..', 'data', 'streams.json');
const PAGE_SIZE = 24;

function loadData() {
  try {
    const raw = fs.readFileSync(dataPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed.items) ? parsed.items : [];
  } catch (err) {
    return [];
  }
}

function cleanText(value) {
  if (!value) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function toUrl(id) {
  return `stream://${id}`;
}

function fromUrl(url) {
  if (!url) return null;
  if (url.startsWith('stream://')) return url.replace('stream://', '');
  return null;
}

function normalizeItem(item) {
  return {
    id: item.id,
    title: cleanText(item.title) || 'Untitled',
    cover: item.cover || '',
    description: cleanText(item.description || ''),
    genres: Array.isArray(item.genres) ? item.genres : [],
    stream: item.stream || ''
  };
}

async function getLatest(page = 1) {
  const pageNum = Number(page) || 1;
  const items = loadData().map(normalizeItem);
  const start = (pageNum - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  return slice.map((item) => ({
    title: item.title,
    url: toUrl(item.id),
    cover: item.cover
  }));
}

async function search(query) {
  const q = cleanText(query).toLowerCase();
  if (!q) return [];
  const items = loadData().map(normalizeItem);
  const filtered = items.filter((item) =>
    item.title.toLowerCase().includes(q)
  );
  return filtered.map((item) => ({
    title: item.title,
    url: toUrl(item.id),
    cover: item.cover
  }));
}

async function getManga(url) {
  const id = fromUrl(url);
  const items = loadData().map(normalizeItem);
  const item = items.find((it) => it.id === id) || items[0];
  if (!item) {
    return {
      title: 'Tidak ada data',
      url: url || '',
      cover: '',
      description: '',
      chapters: [],
      status: '-',
      author: '-',
      artist: '-',
      type: 'Streaming',
      genres: []
    };
  }

  return {
    title: item.title,
    url: toUrl(item.id),
    cover: item.cover,
    description: item.description,
    chapters: [
      {
        name: 'Streaming',
        url: toUrl(item.id)
      }
    ],
    status: 'Available',
    author: '-',
    artist: '-',
    type: 'Streaming',
    genres: item.genres
  };
}

async function getChapter(url) {
  const id = fromUrl(url);
  const items = loadData().map(normalizeItem);
  const item = items.find((it) => it.id === id) || items[0];
  if (!item) {
    return {
      title: 'Streaming',
      video: '',
      images: [],
      nav: { prev: null, next: null }
    };
  }

  return {
    title: item.title,
    video: item.stream,
    images: [],
    nav: { prev: null, next: null }
  };
}

module.exports = {
  id: 'streaming',
  name: 'Streaming Lokal',
  baseUrl,
  search,
  getLatest,
  getManga,
  getChapter
};
