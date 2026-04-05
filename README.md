# VimDown — macOS Markdown Editor

A native macOS markdown editor with Vim keybindings, live split-pane preview, and a rich formatting toolbar — built with Electron + React + CodeMirror 6.

## Features

- **Vim mode** — full Normal / Insert / Visual / Replace support via CodeMirror Vim (toggle with `⌘⌥V` or the toolbar switch)
- **Markdown toolbar** — when Vim mode is off, a formatting bar appears with buttons for headings, bold, italic, strikethrough, code, blockquote, lists, links, tables, and more
- **Live split-pane preview** — rendered markdown updates as you type; resize the divider by dragging
- **Native macOS integration** — hidden-inset titlebar, traffic lights, vibrancy, unsaved-changes dot, represented filename, Recent Documents
- **File associations** — double-clicking any `.md`, `.markdown`, or `.txt` file opens it directly in VimDown
- **Dark / Light mode** — follows system preference; toggle with `⌘⌥D` or the toolbar button
- **Print & PDF export** — via the native print dialog (`⌘P` / `⌘⇧P`)
- **XSS-safe preview** — markdown HTML output is sanitized with DOMPurify before rendering

## Prerequisites

- **Node.js** 18+ (`brew install node`)
- **npm** 9+

## Setup

```bash
cd vim-md-editor
npm install
```

## Running in Development

```bash
npm run electron:dev
```

Starts Vite on port 5173, then launches Electron pointing at it. Hot-reload is active — changes to the React source update instantly.

## Building the macOS App (.dmg)

### Apple Silicon (M1/M2/M3) — arm64
```bash
npm run electron:build
```
Output: `release/VimDown-1.0.0-arm64.dmg`

### Intel Mac — x64
```bash
npm run electron:build:x64
```

### Universal (both architectures)
```bash
npm run electron:build:universal
```

## Installing

1. Run the build command above
2. Open `release/VimDown-1.0.0-arm64.dmg`
3. Drag **VimDown** to `/Applications`
4. Launch from Spotlight or the Applications folder

> **Note:** The app is not code-signed. On first launch you may need to right-click → Open, or go to System Settings → Privacy & Security → Open Anyway.

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `⌘N` | New file |
| `⌘O` | Open file |
| `⌘S` | Save |
| `⌘⇧S` | Save As |
| `⌘W` | Close window |
| `⌘Q` | Quit |
| `⌘\` | Toggle preview pane |
| `⌘⌥V` | Toggle Vim mode |
| `⌘⌥D` | Toggle dark mode |
| `⌘F` | Find |
| `⌘P` | Print |
| `⌘⇧P` | Export as PDF |

## Markdown Toolbar (non-Vim mode)

When Vim mode is disabled, a formatting toolbar appears below the main toolbar:

| Button | Inserts |
|--------|---------|
| H1 / H2 / H3 | `# ` / `## ` / `### ` prefix on current line |
| Bold | `**selected**` |
| Italic | `*selected*` |
| Strikethrough | `~~selected~~` |
| Inline code | `` `selected` `` |
| Blockquote | `> ` prefix on current line |
| Bullet list | `- ` prefix |
| Numbered list | `1. ` prefix |
| Link | `[selected](url)` |
| Table | 3-column table template |
| Horizontal rule | `---` |
| Code block | fenced ` ``` ` block |

Buttons wrap the current selection when text is selected, or insert a placeholder at the cursor.

## Project Structure

```
electron/        Main process — window, file I/O, native menus, IPC
  main.cjs
  preload.cjs    Context bridge (secure IPC API exposed to renderer)

client/src/
  pages/
    editor.tsx   Editor component — CodeMirror, toolbar, preview, file ops

server/          Express app (dev server / future web mode)
shared/
  schema.ts      Zod + Drizzle ORM type definitions

script/
  build.ts       Vite + esbuild build orchestration
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
