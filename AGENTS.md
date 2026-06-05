<claude-mem-context>
# Memory Context

# [vim-md-editor] recent context, 2026-05-04 2:35pm PDT

No previous sessions found.
</claude-mem-context>

## Cursor Cloud specific instructions

VimDown is a single-package npm app (not a monorepo): a Vim-keybinding markdown editor with live split-pane preview. See `README.md` for full product docs.

### Services

| Service | Port | When needed |
|---------|------|-------------|
| Express + Vite dev server (`npm run dev`) | 5000 | Primary web development |
| Vite alone (`npx vite`) | 5173 | Used by `npm run electron:dev` |
| Production static server (`npm start`) | 5000 | After `npm run build:web` + full server build |

No database, Docker, or nginx is required for local development. PostgreSQL/Drizzle deps are scaffolding only and are not wired into runtime.

### Standard commands

- **Install deps:** `npm install`
- **Dev (web):** `npm run dev` → http://localhost:5000
- **Type check:** `npm run check` (runs `tsc`; no ESLint configured)
- **Build web:** `npm run build:web` → `dist/public/`
- **Desktop dev:** `npm run electron:dev` (requires display; macOS builds need Xcode CLI tools)

### Cloud VM notes

- **Web is the primary E2E path on Linux.** Electron desktop dev/build targets macOS and is not practical in this Linux cloud VM.
- The dev server binds to `0.0.0.0:5000` via Express. Use port 5000 for browser testing.
- There is no automated test suite in this repo; verify changes with `npm run check` and manual browser testing.
- `npm run build:web` succeeds independently of the dev server and produces static assets in `dist/public/`.
