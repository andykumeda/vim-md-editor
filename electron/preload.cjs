'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const RECEIVE_CHANNELS = new Set([
  'menu-new-file',
  'menu-open-file',
  'file-saved',
  'file-location-changed',
  'menu-find',
  'menu-toggle-preview',
  'menu-toggle-vim',
  'menu-toggle-dark',
  'menu-print',
  'menu-export-pdf',
  'menu-toggle-editor',
  'menu-set-view-mode',
]);

function on(channel, listener) {
  if (!RECEIVE_CHANNELS.has(channel)) return;
  ipcRenderer.on(channel, listener);
}

// Expose a safe, typed API to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // Notify main that content changed
  contentChanged: (content, isDirty) =>
    ipcRenderer.send('content-changed', { content, isDirty }),

  // Notify main of current file path
  setFilePath: (filePath) =>
    ipcRenderer.send('set-file-path', filePath),

  setDirty: (isDirty) =>
    ipcRenderer.send('set-dirty', isDirty),

  // Sync menu checkbox state
  syncVimState: (enabled) =>
    ipcRenderer.send('sync-vim-state', { enabled }),

  syncDarkState: (dark) =>
    ipcRenderer.send('sync-dark-state', { dark }),

  // Menu-triggered actions → renderer listens for these
  onNewFile: (cb) => on('menu-new-file', (event, data) => cb(data)),
  onOpenFile: (cb) => on('menu-open-file', (event, data) => cb(data)),
  onFileSaved: (cb) => on('file-saved', (event, data) => cb(data)),
  onFileLocationChanged: (cb) => on('file-location-changed', (event, data) => cb(data)),
  onFind: (cb) => on('menu-find', cb),
  onTogglePreview: (cb) => on('menu-toggle-preview', cb),
  onToggleVim: (cb) => on('menu-toggle-vim', (event, data) => cb(data)),
  onToggleDark: (cb) => on('menu-toggle-dark', (event, data) => cb(data)),
  onPrint: (cb) => on('menu-print', cb),
  onExportPdf: (cb) => on('menu-export-pdf', cb),
  onToggleEditor: (cb) => on('menu-toggle-editor', cb),
  onSetViewMode: (cb) => on('menu-set-view-mode', (event, data) => cb(data)),

  // Initial window mode passed via additionalArguments at window creation
  getInitMode: () => {
    const arg = process.argv.find((a) => typeof a === 'string' && a.startsWith('--vimdown-mode='));
    return arg ? arg.split('=')[1] : 'split';
  },

  // Toolbar-button-triggered actions (renderer → main)
  openFileDialog: () => ipcRenderer.send('toolbar-open-file'),
  newFileAction:  () => ipcRenderer.send('toolbar-new-file'),
  saveFileAction: () => ipcRenderer.send('toolbar-save-file'),
  revealInFinder: () => ipcRenderer.send('toolbar-reveal-file'),
  renameFile: (newName) => ipcRenderer.invoke('rename-file', newName),
  moveFile: () => ipcRenderer.invoke('move-file'),
  saveFile: () => ipcRenderer.invoke('save-file'),
  saveAndCloseFile: () => ipcRenderer.invoke('save-and-close-file'),
  closeWindow: (force) => ipcRenderer.invoke('close-window', { force }),

  // Remove listeners (cleanup) — only known main→renderer channels
  removeAllListeners: (channel) => {
    if (!RECEIVE_CHANNELS.has(channel)) return;
    ipcRenderer.removeAllListeners(channel);
  },

  // Is running inside Electron?
  isElectron: true,
});
