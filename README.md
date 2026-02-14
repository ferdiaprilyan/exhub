# Manga Reader - Extension Based

Webapp sederhana untuk membaca manga dengan sistem Extension. Setiap situs dibuat sebagai extension terpisah sehingga mudah menambah sumber baru.

## Fitur

- Sistem extension modular
- API terpusat untuk search, latest, detail manga, dan chapter
- Proxy gambar untuk menghindari CORS/hotlink
- UI single-page ringan

## Menjalankan

1. Install dependency

```
npm install
```

2. (Opsional) Jika situs memakai proteksi Cloudflare, aktifkan Playwright:

```
npm install
npx playwright install chromium
```

3. Jalankan server

```
npm run dev
```

Akses di `http://localhost:3000`.

## Jalankan Cepat (bash start)

```
bash start
```

Script ini otomatis:
- Menjalankan `npm install` jika `node_modules` belum ada.
- Mengaktifkan `USE_JINA=1` otomatis di Android/Termux.

## Konfigurasi

- `PORT`: port server (default 3000)
- `USE_PLAYWRIGHT=1`: paksa render via Playwright untuk situs yang memblokir request biasa
- `USE_JINA=1`: fallback memakai Jina Reader (berguna di Termux/Android saat Playwright tidak tersedia)

## Tambah Extension

Lihat panduan di `extensions/README.md`.

## Catatan Legal

Pastikan penggunaan sesuai dengan hak cipta dan Terms of Service dari situs sumber.
