const express = require('express');
const path = require('node:path');
const { loadExtensions } = require('./extensions');
const { proxyImage, proxyStream, closeBrowser } = require('./lib/http');

const app = express();
const port = Number(process.env.PORT) || 3000;
const extensions = loadExtensions();

app.use(express.json({ limit: '1mb' }));

function getExtension(req, res) {
  const ext = extensions.get(req.params.ext);
  if (!ext) {
    res.status(404).json({ error: 'Extension tidak ditemukan' });
    return null;
  }
  return ext;
}

app.get('/api/extensions', (req, res) => {
  res.json({
    extensions: extensions.list()
  });
});

app.get('/api/:ext/latest', async (req, res) => {
  const ext = getExtension(req, res);
  if (!ext) return;
  try {
    const items = await ext.getLatest(req.query.page, req.query.type);
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/:ext/search', async (req, res) => {
  const ext = getExtension(req, res);
  if (!ext) return;
  try {
    const items = await ext.search(req.query.q || '');
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/:ext/manga', async (req, res) => {
  const ext = getExtension(req, res);
  if (!ext) return;
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: 'Param url wajib diisi' });
    return;
  }
  try {
    const data = await ext.getManga(url);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/:ext/chapter', async (req, res) => {
  const ext = getExtension(req, res);
  if (!ext) return;
  const url = req.query.url;
  if (!url) {
    res.status(400).json({ error: 'Param url wajib diisi' });
    return;
  }
  try {
    const data = await ext.getChapter(url);
    res.json({ data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/image', async (req, res) => {
  const imageUrl = req.query.url;
  if (!imageUrl) {
    res.status(400).end();
    return;
  }
  try {
    await proxyImage(req, res, imageUrl, req.query.referer);
  } catch (err) {
    res.status(502).end();
  }
});

app.get('/api/stream', async (req, res) => {
  const streamUrl = req.query.url;
  if (!streamUrl) {
    res.status(400).end();
    return;
  }
  try {
    await proxyStream(req, res, streamUrl, req.query.referer);
  } catch (err) {
    res.status(502).end();
  }
});

app.use('/', express.static(path.join(__dirname, 'public')));

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server jalan di http://localhost:${port}`);
});

process.on('SIGINT', async () => {
  await closeBrowser();
  process.exit(0);
});
