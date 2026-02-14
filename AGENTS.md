# Repository Guidelines

## Project Structure & Module Organization
- `server.js` is the Express API entry point.
- `lib/` contains shared utilities (HTTP fetch, proxy, caching).
- `extensions/` holds site-specific parsers. Each extension exports `id`, `name`, `baseUrl`, `search`, `getLatest`, `getManga`, `getChapter`.
- `public/` is the static web UI (`index.html`, `app.js`, `app.css`).
- `start` is the convenience launcher for local dev.

## Build, Test, and Development Commands
- `bash start`: installs dependencies if needed and starts the server (auto-sets `USE_JINA=1` on Android).
- `npm run dev`: starts `server.js` directly.
- `npm start`: same as `npm run dev`.
- `USE_JINA=1 bash start`: force Jina Reader fallback for Cloudflare-protected pages.
- `USE_PLAYWRIGHT=1 bash start`: use Playwright rendering (desktop only); install with `npx playwright install chromium`.

## Coding Style & Naming Conventions
- JavaScript (CommonJS), 2-space indentation, semicolons.
- Use `camelCase` for functions/variables, `PascalCase` for component-like names, and `kebab-case` for file names when appropriate.
- Extensions should be named after the site (e.g., `extensions/doujindesu.js`) and export an `id` matching the filename.

## Testing Guidelines
- No automated test framework is configured.
- When adding tests, prefer a `tests/` directory and keep test names aligned with module names (e.g., `tests/doujindesu.test.js`).
- Manual smoke test: run `bash start` and hit `/api/:ext/latest`, `/api/:ext/manga`, `/api/:ext/chapter`.

## Commit & Pull Request Guidelines
- Git history shows a single commit (“Backup Termux home”), so no established convention.
- Recommended: use Conventional Commits (e.g., `feat: add new extension`, `fix: filter ads in chapter images`).
- PRs should include: summary, test steps, and screenshots for UI changes.

## Configuration & Security Notes
- Environment variables: `PORT`, `USE_JINA`, `USE_PLAYWRIGHT`.
- Be mindful of site ToS/copyright when adding new extensions or scraping logic.
