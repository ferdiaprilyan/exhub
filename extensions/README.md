# Extension Guide

Setiap extension adalah module Node yang mengekspor object dengan bentuk:

- `id`: string unik (digunakan di URL API)
- `name`: nama tampilan
- `baseUrl`: URL utama situs
- `normalizeUrl(url)`
- `search(query)`
- `getLatest(page)`
- `getManga(url)`
- `getChapter(url)`

Contoh struktur file:

```
extensions/
  doujindesu.js
  contoh-situs.js
```

Cara menambahkan extension baru:

1. Duplikasi file `extensions/doujindesu.js`.
2. Ubah `id`, `name`, dan `baseUrl`.
3. Sesuaikan selector parsing di fungsi `search`, `getLatest`, `getManga`, dan `getChapter`.
4. Jalankan ulang server.

API yang tersedia:

- `GET /api/extensions`
- `GET /api/:ext/latest?page=1`
- `GET /api/:ext/search?q=judul`
- `GET /api/:ext/manga?url=...`
- `GET /api/:ext/chapter?url=...`
- `GET /api/image?url=...`
