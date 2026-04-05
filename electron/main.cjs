'use strict';

const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require('electron');
const path = require('path');
const fs = require('fs');

// ─── Dev mode detection ───────────────────────────────────────────────────────
const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

// Keep a global reference of the window
let mainWindow = null;

// File path requested before window was ready (double-click before app launched)
let pendingFileToOpen = null;

// ─── Window creation ──────────────────────────────────────────────────────────
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 700,
    minHeight: 500,
    titleBarStyle: 'hiddenInset',   // macOS native traffic lights + inset title bar
    vibrancy: 'under-window',       // macOS vibrancy effect
    visualEffectState: 'active',
    backgroundColor: '#00000000',
    title: 'VimDown',
    icon: path.join(__dirname, 'icon.icns'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'public', 'index.html'));
  }

  // Track current file state
  mainWindow._filePath = null;
  mainWindow._isDirty = false;

  // Load any file that was double-clicked before the window existed
  mainWindow.webContents.on('did-finish-load', () => {
    if (pendingFileToOpen) {
      const filePath = pendingFileToOpen;
      pendingFileToOpen = null;
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        mainWindow._filePath = filePath;
        mainWindow._isDirty = false;
        mainWindow.webContents.send('menu-open-file', { content, filePath, fileName: path.basename(filePath) });
        updateWindowTitle();
        app.addRecentDocument(filePath);
      } catch (e) {
        dialog.showErrorBox('Error opening file', String(e));
      }
    }
  });

  mainWindow.on('close', (e) => {
    if (mainWindow._isDirty) {
      e.preventDefault();
      dialog.showMessageBox(mainWindow, {
        type: 'question',
        buttons: ['Save', "Don't Save", 'Cancel'],
        defaultId: 0,
        cancelId: 2,
        message: 'Do you want to save your changes?',
        detail: mainWindow._filePath
          ? `Your changes to "${path.basename(mainWindow._filePath)}" will be lost if you don't save.`
          : 'Your unsaved document will be lost.',
      }).then(({ response }) => {
        if (response === 0) {
          // Save then close
          handleSaveFile(true);
        } else if (response === 1) {
          mainWindow._isDirty = false;
          mainWindow.close();
        }
        // response === 2 → Cancel, do nothing
      });
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── IPC: content changed ──────────────────────────────────────────────────────
ipcMain.on('content-changed', (event, { content, isDirty }) => {
  if (!mainWindow) return;
  mainWindow._isDirty = isDirty;
  updateWindowTitle();
});

// ─── IPC: get content (for save) ──────────────────────────────────────────────
ipcMain.handle('get-content', async () => {
  if (!mainWindow) return '';
  return new Promise((resolve) => {
    mainWindow.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()')
      .then(resolve)
      .catch(() => resolve(''));
  });
});

// ─── Window title helpers ─────────────────────────────────────────────────────
function updateWindowTitle() {
  if (!mainWindow) return;
  const base = mainWindow._filePath ? path.basename(mainWindow._filePath) : 'Untitled';
  const dirty = mainWindow._isDirty ? ' •' : '';
  mainWindow.setTitle(`${base}${dirty} — VimDown`);
  mainWindow.setRepresentedFilename(mainWindow._filePath || '');
  mainWindow.setDocumentEdited(mainWindow._isDirty);
}

// ─── File operations ───────────────────────────────────────────────────────────
async function handleNewFile() {
  if (!mainWindow) return;
  if (mainWindow._isDirty) {
    const { response } = await dialog.showMessageBox(mainWindow, {
      type: 'question',
      buttons: ['Save', "Don't Save", 'Cancel'],
      defaultId: 0,
      cancelId: 2,
      message: 'Save changes before creating a new file?',
    });
    if (response === 0) await handleSaveFile(false);
    if (response === 2) return;
  }
  mainWindow._filePath = null;
  mainWindow._isDirty = false;
  mainWindow.webContents.send('menu-new-file');
  updateWindowTitle();
}

async function handleOpenFile() {
  if (!mainWindow) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
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
  const content = fs.readFileSync(filePath, 'utf-8');
  mainWindow._filePath = filePath;
  mainWindow._isDirty = false;
  mainWindow.webContents.send('menu-open-file', { content, filePath, fileName: path.basename(filePath) });
  updateWindowTitle();
  // Add to recent documents
  app.addRecentDocument(filePath);
}

async function handleSaveFile(closeAfter = false) {
  if (!mainWindow) return;
  if (mainWindow._filePath) {
    // Save in place
    const content = await ipcMain.handle ? await mainWindow.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()') : '';
    fs.writeFileSync(mainWindow._filePath, content, 'utf-8');
    mainWindow._isDirty = false;
    updateWindowTitle();
    mainWindow.webContents.send('file-saved', { filePath: mainWindow._filePath });
    if (closeAfter) mainWindow.close();
  } else {
    await handleSaveAsFile(closeAfter);
  }
}

async function handleSaveAsFile(closeAfter = false) {
  if (!mainWindow) return;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save Markdown File',
    defaultPath: mainWindow._filePath || 'untitled.md',
    filters: [
      { name: 'Markdown', extensions: ['md'] },
      { name: 'Text', extensions: ['txt'] },
    ],
  });
  if (canceled || !filePath) return;

  const content = await mainWindow.webContents.executeJavaScript('window.__getEditorContent && window.__getEditorContent()');
  fs.writeFileSync(filePath, content || '', 'utf-8');
  mainWindow._filePath = filePath;
  mainWindow._isDirty = false;
  updateWindowTitle();
  mainWindow.webContents.send('file-saved', { filePath });
  app.addRecentDocument(filePath);
  if (closeAfter) mainWindow.close();
}

// ─── IPC handlers (called from renderer via menu) ─────────────────────────────
ipcMain.handle('dialog-open-file', async () => {
  await handleOpenFile();
});

ipcMain.handle('dialog-save-file', async () => {
  await handleSaveFile(false);
});

ipcMain.handle('dialog-save-as-file', async () => {
  await handleSaveAsFile(false);
});

ipcMain.handle('dialog-new-file', async () => {
  await handleNewFile();
});

// Called by renderer to set file path after drag-drop or other opens
ipcMain.on('set-file-path', (event, filePath) => {
  if (!mainWindow) return;
  mainWindow._filePath = filePath;
  updateWindowTitle();
  if (filePath) app.addRecentDocument(filePath);
});

ipcMain.on('set-dirty', (event, isDirty) => {
  if (!mainWindow) return;
  mainWindow._isDirty = isDirty;
  mainWindow.setDocumentEdited(isDirty);
  updateWindowTitle();
});

// ─── macOS native menu ────────────────────────────────────────────────────────
function buildMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // App menu (macOS only)
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

    // File
    {
      label: 'File',
      submenu: [
        {
          label: 'New',
          accelerator: 'CmdOrCtrl+N',
          click: () => handleNewFile(),
        },
        {
          label: 'Open…',
          accelerator: 'CmdOrCtrl+O',
          click: () => handleOpenFile(),
        },
        { type: 'separator' },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => handleSaveFile(false),
        },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => handleSaveAsFile(false),
        },
        { type: 'separator' },
        ...(isMac ? [
          { role: 'close' },
        ] : [
          { role: 'quit' },
        ]),
      ],
    },

    // Edit
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
        {
          label: 'Find…',
          accelerator: 'CmdOrCtrl+F',
          click: () => mainWindow && mainWindow.webContents.send('menu-find'),
        },
      ],
    },

    // View
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Preview',
          accelerator: 'CmdOrCtrl+\\',
          click: () => mainWindow && mainWindow.webContents.send('menu-toggle-preview'),
        },
        { type: 'separator' },
        {
          label: 'Vim Mode',
          accelerator: 'CmdOrCtrl+Alt+V',
          type: 'checkbox',
          checked: true,
          id: 'vim-mode',
          click: (menuItem) => {
            mainWindow && mainWindow.webContents.send('menu-toggle-vim', { enabled: menuItem.checked });
          },
        },
        { type: 'separator' },
        {
          label: 'Dark Mode',
          accelerator: 'CmdOrCtrl+Alt+D',
          type: 'checkbox',
          checked: false,
          id: 'dark-mode',
          click: (menuItem) => {
            mainWindow && mainWindow.webContents.send('menu-toggle-dark', { dark: menuItem.checked });
          },
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

    // Export
    {
      label: 'Export',
      submenu: [
        {
          label: 'Print…',
          accelerator: 'CmdOrCtrl+P',
          click: () => mainWindow && mainWindow.webContents.send('menu-print'),
        },
        {
          label: 'Export as PDF…',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => mainWindow && mainWindow.webContents.send('menu-export-pdf'),
        },
      ],
    },

    // Window (macOS)
    ...(isMac ? [{
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    }] : []),

    // Help
    {
      role: 'help',
      submenu: [
        {
          label: 'Learn More',
          click: () => shell.openExternal('https://www.perplexity.ai/computer'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  return menu;
}

// ─── Sync vim/dark menu checkboxes from renderer ──────────────────────────────
// ─── Toolbar button IPC (renderer → main) ────────────────────────────────────
ipcMain.on('toolbar-new-file',  () => handleNewFile());
ipcMain.on('toolbar-open-file', () => handleOpenFile());
ipcMain.on('toolbar-save-file', () => handleSaveFile());

ipcMain.on('sync-vim-state', (event, { enabled }) => {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('vim-mode');
  if (item) item.checked = enabled;
});

ipcMain.on('sync-dark-state', (event, { dark }) => {
  const menu = Menu.getApplicationMenu();
  if (!menu) return;
  const item = menu.getMenuItemById('dark-mode');
  if (item) item.checked = dark;
});

// ─── Open file from command line / recent docs ────────────────────────────────
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (mainWindow && mainWindow.webContents) {
    // App already running — send immediately
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      mainWindow._filePath = filePath;
      mainWindow._isDirty = false;
      mainWindow.webContents.send('menu-open-file', { content, filePath, fileName: path.basename(filePath) });
      updateWindowTitle();
      app.addRecentDocument(filePath);
      mainWindow.focus();
    } catch (e) {
      dialog.showErrorBox('Error opening file', String(e));
    }
  } else {
    // App not yet ready — stash for after window loads
    pendingFileToOpen = filePath;
  }
});

// ─── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
