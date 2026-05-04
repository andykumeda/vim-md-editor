'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell, session } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// ─── Dev mode detection ───────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// File path requested before any window was ready (cold launch from Finder)
let pendingFileToOpen = null;
// Non-markdown file dropped onto app at cold launch — convert via markitdown
let pendingFileToConvert = null;
// Result of a markitdown conversion, to load into the next window that opens
let pendingConvertedDoc = null;

// Extensions that should route through markitdown rather than open as text
const NON_MD_EXTS = new Set([
  '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
  '.html', '.htm', '.csv', '.xml', '.json', '.epub',
  '.png', '.jpg', '.jpeg', '.tiff', '.bmp',
  '.mp3', '.wav', '.m4a', '.flac', '.ogg',
  '.zip',
]);

function isMarkitdownTarget(filePath) {
  return NON_MD_EXTS.has(path.extname(filePath).toLowerCase());
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function focusedWin() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function winFromEvent(event) {
  return BrowserWindow.fromWebContents(event.sender);
}

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow(opts = {}) {
  const { initialMode = 'edit' } = opts;

  const additionalArguments = [`--vimdown-mode=${initialMode}`];

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    title: 'VimDown',
    icon: path.join(__dirname, 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments,
    },
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'public', 'index.html'));
  }

  // Per-window state
  win._filePath = null;
  win._isDirty = false;
  win._initialMode = initialMode;

  // ─── Navigation guards ────────────────────────────────────────────────────
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  // ─── Context menu (right-click) ───────────────────────────────────────────
  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.selectionText) {
      items.push({ role: 'copy' });
      if (params.isEditable) {
        items.push({ role: 'cut' });
        items.push({ type: 'separator' });
      }
    }
    if (params.isEditable) {
      items.push({ role: 'paste' });
      items.push({ role: 'selectAll' });
    }
    if (items.length > 0) {
      Menu.buildFromTemplate(items).popup({ window: win });
    }
  });

  // Load any file that was double-clicked before this window existed
  win.webContents.on('did-finish-load', () => {
    if (pendingConvertedDoc) {
      const { content, fileName } = pendingConvertedDoc;
      pendingConvertedDoc = null;
      win._filePath = null;
      win._isDirty = true; // unsaved derivative — user must Save As
      win.webContents.send('menu-open-file', { content, filePath: null, fileName });
      updateWindowTitle(win);
      app.focus({ steal: true });
      win.show();
      win.focus();
      return;
    }
    if (pendingFileToOpen) {
      const filePath = pendingFileToOpen;
      pendingFileToOpen = null;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        win._filePath = filePath;
        win._isDirty = false;
        win.webContents.send('menu-open-file', { content, filePath, fileName: path.basename(filePath) });
        updateWindowTitle(win);
        app.addRecentDocument(filePath);
        app.focus({ steal: true });
        win.show();
        win.focus();
      } catch (e) {
        dialog.showErrorBox('Error opening file', String(e));
      }
    }
  });

  win.on('close', (e) => {
    if (win._isDirty) {
      e.preventDefault();
      dialog.showMessageBox(win, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: 'Do you want to save your changes?',
        detail: win._filePath
          ? `Your changes to "${path.basename(win._filePath)}" will be lost if you don't save.`
          : 'Your unsaved document will be lost.',
      }).then(({ response }) => {
        if (response === 0) {
          handleSaveFile(win, true);
        } else if (response === 1) {
          win._isDirty = false;
          win.close();
        }
      });
    }
  });

  return win;
}

// ─── Window title helpers ─────────────────────────────────────────────────────
function updateWindowTitle(win) {
  if (!win || win.isDestroyed()) return;
  const base = win._filePath ? path.basename(win._filePath) : 'Untitled';
  const dirty = win._isDirty ? ' •' : '';
  win.setTitle(`${base}${dirty} — VimDown`);
  win.setRepresentedFilename(win._filePath || '');
  win.setDocumentEdited(win._isDirty);
}

// ─── File operations ──────────────────────────────────────────────────────────
async function handleNewFile(win) {
  win = win || focusedWin();
  if (!win) { createWindow(); return; }
  if (win._isDirty) {
    const { response } = await dialog.showMessageBox(win, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes before creating a new file?',
    });
    if (response === 0) await handleSaveFile(win, false);
    if (response === 2) return;
  }
  win._filePath = null;
  win._isDirty = false;
  win.webContents.send('menu-new-file');
  updateWindowTitle(win);
}

async function handleOpenFile(win) {
  win = win || focusedWin();
  if (!win) { createWindow(); return; }
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open Markdown File',
    filters: [
      { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'mkd', 'mdwn', 'mdtxt', 'mdtext'] },
      { name: 'Text Files', extensions: ['txt', 'text'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return;

  const filePath = filePaths[0];
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (e) {
    dialog.showErrorBox('Error opening file', String(e));
    return;
  }
  win._filePath = filePath;
  win._isDirty = false;
  win.webContents.send('menu-open-file', { content, filePath, fileName: path.basename(filePath) });
  updateWindowTitle(win);
  app.addRecentDocument(filePath);
}

async function handleSaveFile(win, closeAfter = false) {
  win = win || focusedWin();
  if (!win) return;
  if (win._filePath) {
    const content = await win.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()');
    try {
      fs.writeFileSync(win._filePath, content || '', 'utf-8');
    } catch (e) {
      dialog.showErrorBox('Error saving file', String(e));
      return;
    }
    win._isDirty = false;
    updateWindowTitle(win);
    win.webContents.send('file-saved', { filePath: win._filePath });
    if (closeAfter) win.close();
  } else {
    await handleSaveAsFile(win, closeAfter);
  }
}

async function handleSaveAsFile(win, closeAfter = false) {
  win = win || focusedWin();
  if (!win) return;
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Markdown File',
    defaultPath: win._filePath || 'untitled.md',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  if (canceled || !filePath) return;

  const content = await win.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()');
  try {
    fs.writeFileSync(filePath, content || '', 'utf-8');
  } catch (e) {
    dialog.showErrorBox('Error saving file', String(e));
    return;
  }
  win._filePath = filePath;
  win._isDirty = false;
  updateWindowTitle(win);
  win.webContents.send('file-saved', { filePath });
  app.addRecentDocument(filePath);
  if (closeAfter) win.close();
}

// ─── IPC: per-window state from renderer ─────────────────────────────────────
ipcMain.on('content-changed', (event, { isDirty }) => {
  const win = winFromEvent(event);
  if (!win) return;
  win._isDirty = isDirty;
  updateWindowTitle(win);
});

ipcMain.handle('get-content', async (event) => {
  const win = winFromEvent(event);
  if (!win) return '';
  return new Promise((resolve) => {
    win.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()')
      .then(resolve)
      .catch(() => resolve(''));
  });
});

ipcMain.on('set-file-path', (event, filePath) => {
  const win = winFromEvent(event);
  if (!win) return;
  win._filePath = filePath;
  updateWindowTitle(win);
  if (filePath) app.addRecentDocument(filePath);
});

ipcMain.on('set-dirty', (event, isDirty) => {
  const win = winFromEvent(event);
  if (!win) return;
  win._isDirty = isDirty;
  win.setDocumentEdited(isDirty);
  updateWindowTitle(win);
});

// ─── Toolbar button IPC (renderer → main) ────────────────────────────────────
ipcMain.on('toolbar-new-file',  (event) => handleNewFile(winFromEvent(event)));
ipcMain.on('toolbar-open-file', (event) => handleOpenFile(winFromEvent(event)));
ipcMain.on('toolbar-save-file', (event) => handleSaveFile(winFromEvent(event), false));

ipcMain.on('sync-vim-state', (_event, { enabled }) => {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('vim-mode');
  if (item) item.checked = enabled;
});

ipcMain.on('sync-dark-state', (_event, { dark }) => {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('dark-mode');
  if (item) item.checked = dark;
});

// ─── macOS native menu ────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const sendFocused = (channel, payload) => {
    const win = focusedWin();
    if (win) win.webContents.send(channel, payload);
  };

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    }] : []),

    {
      label: 'File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => handleNewFile() },
        {
          label: 'New Window',
          accelerator: 'CmdOrCtrl+Shift+N',
          click: () => createWindow({ initialMode: 'preview' }),
        },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => handleOpenFile() },
        { label: 'Convert to Markdown…', accelerator: 'CmdOrCtrl+Shift+O', click: () => handleConvertDialog() },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: () => handleSaveFile() },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: () => handleSaveAsFile() },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },

    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: () => sendFocused('menu-find') },
      ],
    },

    {
      label: 'View',
      submenu: [
        { label: 'Toggle Editor', accelerator: 'CmdOrCtrl+E', click: () => sendFocused('menu-toggle-editor') },
        { label: 'Toggle Preview', accelerator: 'CmdOrCtrl+\\', click: () => sendFocused('menu-toggle-preview') },
        { type: 'separator' },
        {
          label: 'Vim Mode',
          accelerator: 'CmdOrCtrl+Alt+V',
          type: 'checkbox',
          checked: true,
          id: 'vim-mode',
          click: (menuItem) => sendFocused('menu-toggle-vim', { enabled: menuItem.checked }),
        },
        { type: 'separator' },
        {
          label: 'Dark Mode',
          accelerator: 'CmdOrCtrl+Alt+D',
          type: 'checkbox',
          checked: false,
          id: 'dark-mode',
          click: (menuItem) => sendFocused('menu-toggle-dark', { dark: menuItem.checked }),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
        ] : []),
      ],
    },

    {
      label: 'Export',
      submenu: [
        { label: 'Print…', accelerator: 'CmdOrCtrl+P', click: () => sendFocused('menu-print') },
        { label: 'Export as PDF…', accelerator: 'CmdOrCtrl+Shift+P', click: () => sendFocused('menu-export-pdf') },
      ],
    },

    ...(isMac ? [{
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    }] : []),

    {
      role: 'help',
      submenu: [
        { label: 'Learn More', click: () => shell.openExternal('https://www.perplexity.ai/computer') },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// ─── markitdown conversion ────────────────────────────────────────────────────
// Spawn via a login shell so we inherit the user's PATH (pip-installed
// markitdown frequently lives in ~/.local/bin or pyenv shims that the
// GUI-launched Electron process otherwise cannot see).
function convertWithMarkitdown(filePath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('/bin/bash', ['-lc', 'markitdown -- "$VIMDOWN_FILE"'], {
      env: { ...process.env, VIMDOWN_FILE: filePath },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', (d) => { stdout += d.toString(); });
    proc.stderr.on('data', (d) => { stderr += d.toString(); });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) return resolve(stdout);
      if (code === 127 || /command not found|markitdown:.*not found/i.test(stderr)) {
        return reject(new Error('NOT_INSTALLED'));
      }
      reject(new Error(stderr.trim() || `markitdown exited with code ${code}`));
    });
  });
}

function showMarkitdownInstallDialog(win) {
  const target = win || focusedWin();
  const detail = [
    'VimDown converts Office docs, PDFs, HTML, images and audio to',
    'Markdown using Microsoft markitdown. Install one of:',
    '',
    '  pipx install markitdown[all]',
    '  pip install markitdown[all]',
    '',
    'After installing, restart VimDown so the app picks up the new PATH.',
  ].join('\n');
  dialog.showMessageBox(target, {
    type: 'info',
    title: 'markitdown not found',
    message: 'markitdown is required to convert this file.',
    detail,
    buttons: ['Open install page', 'OK'],
    defaultId: 1,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) shell.openExternal('https://github.com/microsoft/markitdown');
  });
}

async function openConverted(filePath) {
  let content;
  try {
    content = await convertWithMarkitdown(filePath);
  } catch (e) {
    if (e && e.message === 'NOT_INSTALLED') {
      showMarkitdownInstallDialog(null);
    } else {
      dialog.showErrorBox('Conversion failed', String(e && e.message ? e.message : e));
    }
    return;
  }
  const baseName = path.basename(filePath, path.extname(filePath)) + '.md';
  pendingConvertedDoc = { content, fileName: baseName, sourcePath: filePath };
  createWindow({ initialMode: 'preview' });
}

async function handleConvertDialog() {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Convert to Markdown',
    filters: [
      { name: 'Documents',
        extensions: ['pdf','docx','doc','pptx','ppt','xlsx','xls','html','htm','csv','xml','json','epub'] },
      { name: 'Images', extensions: ['png','jpg','jpeg','tiff','bmp'] },
      { name: 'Audio',  extensions: ['mp3','wav','m4a','flac','ogg'] },
      { name: 'All Files', extensions: ['*'] },
    ],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return;
  await openConverted(filePaths[0]);
}

// ─── Open file from command line / recent docs ────────────────────────────────
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) {
    if (isMarkitdownTarget(filePath)) {
      openConverted(filePath);
      app.focus({ steal: true });
    } else {
      pendingFileToOpen = filePath;
      createWindow({ initialMode: 'preview' });
      app.focus({ steal: true });
    }
  } else {
    if (isMarkitdownTarget(filePath)) {
      pendingFileToConvert = filePath;
    } else {
      pendingFileToOpen = filePath;
    }
  }
});

// ─── Content-Security-Policy (production only) ────────────────────────────────
function applyCSP() {
  if (isDev) return;
  const csp = [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob:",
    "script-src 'self'",
    "connect-src 'self'",
  ].join('; ');
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    });
  });
}

// ─── App lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  applyCSP();
  buildMenu();

  // Cold launch: a non-md file was queued for conversion before app was ready
  if (pendingFileToConvert) {
    const f = pendingFileToConvert;
    pendingFileToConvert = null;
    openConverted(f);
  } else {
    createWindow();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      const win = focusedWin();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
