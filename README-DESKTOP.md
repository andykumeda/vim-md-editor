# VimDown — macOS Desktop App

A Vim-keybinding markdown editor with split-pane preview, built with Electron.

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

This starts Vite on port 5173, then launches Electron pointing at it.
Hot-reload is active — changes to the React source update instantly.

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
4. Launch from Spotlight or Applications folder

> **Note:** The app is not code-signed, so on first launch you may need to
> right-click → Open (or go to System Settings → Privacy & Security → Open Anyway).

## Keyboard Shortcuts (macOS)

| Shortcut | Action |
|----------|--------|
| `⌘N` | New file |
| `⌘O` | Open file (native dialog) |
| `⌘S` | Save |
| `⌘⇧S` | Save As |
| `⌘\` | Toggle preview pane |
| `⌘⌥V` | Toggle Vim mode |
| `⌘⌥D` | Toggle dark mode |
| `⌘F` | Find (CodeMirror search) |
| `⌘P` | Print |
| `⌘⇧P` | Export as PDF |
| `⌘W` | Close window |
| `⌘Q` | Quit |

## Features

- **Native macOS titlebar** with traffic lights
- **Unsaved changes dialog** on close
- **Recent documents** (macOS File → Open Recent)
- **Open with** support for `.md`, `.markdown`, `.txt` files
- **Document-edited dot** in title bar when unsaved changes exist
- **Represented filename** (click title to reveal in Finder)
- All web features: Vim keybindings, live preview, dark/light mode, print, PDF export
