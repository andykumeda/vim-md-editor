# VimDown

A Vim-keybinding markdown editor with live split-pane preview. Ships as both a **native macOS desktop app** (Electron) and a **static web app** deployable behind nginx.

## Features

- **Vim mode** — full Normal / Insert / Visual / Replace support via CodeMirror Vim; toggle with the toolbar switch or keyboard shortcut
- **Vim write commands** — `:w`, `:write`, `:wq`, `:writequit`, `:x`, `:q`, `:q!`, `:e`, and `:enew` are wired into the app's native file actions
- **Markdown toolbar** — when Vim mode is off, a formatting bar provides buttons for headings, bold, italic, strikethrough, inline code, blockquote, lists, links, tables, hr, and code blocks
- **Live split-pane preview** — rendered markdown updates as you type; drag the divider to resize
- **Dark / Light mode** — follows system preference on load; toggle any time
- **Print & PDF export** — opens a formatted print window; use "Save as PDF" in the print dialog
- **XSS-safe preview** — HTML output is sanitized with DOMPurify before rendering
- **Native context menu** — right-click in the editor shows Cut / Copy / Paste / Select All (desktop only)
- **Preview-first opening** — opened Markdown files start in preview mode, with toolbar and menu controls for Preview, Edit, or Split View

---

## Desktop (macOS)

### Additional desktop features

- Native hidden-inset titlebar with traffic lights
- Document title control with inline filename rename, overwrite confirmation, saved/unsaved status, folder move, and folder reveal
- Native represented filename metadata for macOS document/proxy behavior
- Recent Documents in the Dock menu
- File > Move To… relocates the current saved document; File > Duplicate creates an unsaved copy in a new window
- Sparkle updates — daily automatic checks plus VimDown > Check for Updates…
- File associations — double-clicking `.md`, `.markdown`, `.mdown`, `.mkd`, or `.txt` opens the file directly; window is raised automatically whether the app is launching fresh, running in the background, or already open with the window closed

### Installing on a MacBook

Download the latest Apple Silicon DMG from
[GitHub Releases](https://github.com/andykumeda/vim-md-editor/releases/latest),
open it, and drag VimDown into Applications. On the first launch, right-click
VimDown and choose **Open**. After that, VimDown checks for signed updates once
a day; use **VimDown → Check for Updates…** to check immediately.

See [docs/UPDATING.md](docs/UPDATING.md) for installation, troubleshooting,
and release instructions.

### Desktop keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` | New file |
| `⌘O` | Open file |
| `⌘S` | Save |
| `⌘⇧S` | Save As |
| `⌘1` | Preview only |
| `⌘2` | Edit only |
| `⌘3` | Split View |
| `⌘W` | Close window |
| `⌘Q` | Quit |
| `⌘\` | Toggle preview pane |
| `⌘⌥V` | Toggle Vim mode |
| `⌘⌥D` | Toggle dark mode |
| `⌘F` | Find |
| `⌘P` | Print |
| `⌘⇧P` | Export as PDF |

### Vim command-line file actions

| Command | Action |
|---------|--------|
| `:w`, `:write` | Save the current document |
| `:wq`, `:writequit`, `:x` | Save, then close the window |
| `:q` | Close the window, prompting for unsaved changes |
| `:q!` | Close the window without saving |
| `:e`, `:edit` | Open a Markdown file |
| `:enew` | Create a new document |

### Development (desktop)

```bash
npm install
npm run electron:dev
```

Starts Vite on port 5173, then launches Electron against it. Hot-reload is active.

### Building the macOS app

> **Every change ships the same way.** Whenever you make a change and rebuild,
> the build is not finished until the new `VimDown.app` has been moved into
> `/Applications/VimDown.app`. Installing into `/Applications` is the final,
> required step of every change-and-build cycle — otherwise you keep running
> the previously installed version.

Before building a releasable app, bump the package version so macOS and
LaunchServices see a new app version:

```bash
npm version patch --no-git-tag-version  # 1.0.0 → 1.0.1
```

Use `minor` or `major` instead of `patch` when the change warrants it. The
version in `package.json` is what Electron Builder writes into
`CFBundleShortVersionString`, `CFBundleVersion`, the DMG name, and the
installed app metadata.

```bash
npm run build                     # Apple Silicon production build, then install to /Applications/VimDown.app
npm run electron:build            # Apple Silicon package only → release/VimDown-${version}-arm64.dmg
npm run electron:build:x64        # Intel package only
npm run electron:build:universal  # Both architectures package only
npm run release:mac               # Signed Apple Silicon DMG + Sparkle appcast
```

`npm run build` is the complete cycle: it builds the app and then performs the
final move into `/Applications`. The `electron:build*` commands only package
the app into `release/` — they do **not** install it, so you must finish the
cycle yourself by running the install step below.

The install step copies the newest matching `VimDown.app` bundle from
`release/` to `/Applications/VimDown.app` and registers it with LaunchServices.
Always run it as the last step after a package-only build, and rerun it if
VimDown was running during the copy (quit VimDown first):

```bash
npm run install:mac
```

If another app does not immediately show VimDown as an option for `.md` files,
launch VimDown once or register it manually:

```bash
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/VimDown.app
```

Official releases use a stable self-signed identity and Sparkle EdDSA
signatures, but are not yet notarized with an Apple Developer ID. On first
launch: right-click → Open, or use System Settings → Privacy & Security → Open
Anyway.

---

## Web

The same React + CodeMirror UI runs in any modern browser. No server-side component is required — everything is client-side.

### Additional web features

- **File System Access API** (Chrome / Edge) — Open and Save operate on files directly on disk without a download prompt; the file handle is retained so Save writes back to the same file in place
- **Fallback** (Firefox / Safari) — Open uses `<input type="file">`; Save triggers a `.md` download
- **localStorage autosave** — content is written to `localStorage` 800 ms after each change and restored automatically on next page load

### Web keyboard shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘/Ctrl+N` | New file |
| `⌘/Ctrl+O` | Open file |
| `⌘/Ctrl+S` | Save |
| `⌘/Ctrl+P` | Print |
| `⌘/Ctrl+⇧+P` | Export as PDF |

### Development (web)

```bash
npm install
npm run dev        # Express + Vite dev server on :5000
```

Or run Vite alone:

```bash
npx vite
```

### Building for web

```bash
npm run build:web
```

Output: `dist/public/` — a fully static bundle with fingerprinted asset filenames.

### Deploying

**1. Build and sync to the remote server:**

```bash
./deploy.sh              # build + rsync to web:/var/www/vd
./deploy.sh --build-only # build only
./deploy.sh --deploy-only # sync existing dist/public without rebuilding
```

Requires an SSH host alias `web` in `~/.ssh/config` with public-key access. The remote user must have write access to `/var/www/vd`.

**2. nginx config:**

A sample config is provided at `nginx-vd.conf`. To install:

```bash
sudo cp nginx-vd.conf /etc/nginx/sites-available/vd
sudo ln -s /etc/nginx/sites-available/vd /etc/nginx/sites-enabled/vd
sudo nginx -t && sudo systemctl reload nginx
```

For HTTPS, run `sudo certbot --nginx -d your.domain.com` then uncomment the HTTPS blocks in the config.

**Remote directory setup (one-time):**

```bash
sudo mkdir -p /var/www/vd
sudo chown $USER:$USER /var/www/vd
```

---

## Project Structure

```
client/src/
  pages/
    editor.tsx       Single-file editor — CodeMirror, toolbar, preview,
                     file ops (Electron IPC + web FSA + fallbacks)

electron/
  main.cjs           Electron main process — window, native menus, file I/O
  preload.cjs        Context bridge exposing a typed IPC API to the renderer

macos-updater/
  Sources/            Native Sparkle updater helper

server/
  index.ts           Express entry point (serves static build in production)

script/
  build.ts           Vite + esbuild build orchestration (desktop full build)

deploy.sh            Build + rsync deploy script (web)
nginx-vd.conf        Sample nginx site config
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Desktop shell | Electron 41 |
| UI framework | React 18 + TypeScript |
| Editor | CodeMirror 6 |
| Vim keybindings | @replit/codemirror-vim |
| Markdown rendering | marked + DOMPurify |
| Styling | Tailwind CSS + shadcn/ui |
| Build | Vite + electron-builder |
| Web deploy | rsync + nginx |

## Prerequisites

- Node.js 18+
- npm 9+
- (Desktop builds) macOS with Xcode command-line tools
