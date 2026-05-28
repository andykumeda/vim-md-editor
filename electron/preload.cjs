'use strict';

const { contextBridge, ipcRenderer } = require('electron');

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
  onNewFile: (cb) => ipcRenderer.on('menu-new-file', (event, data) => cb(data)),
  onOpenFile: (cb) => ipcRenderer.on('menu-open-file', (event, data) => cb(data)),
  onFileSaved: (cb) => ipcRenderer.on('file-saved', (event, data) => cb(data)),
  onFind: (cb) => ipcRenderer.on('menu-find', cb),
  onTogglePreview: (cb) => ipcRenderer.on('menu-toggle-preview', cb),
  onToggleVim: (cb) => ipcRenderer.on('menu-toggle-vim', (event, data) => cb(data)),
  onToggleDark: (cb) => ipcRenderer.on('menu-toggle-dark', (event, data) => cb(data)),
  onPrint: (cb) => ipcRenderer.on('menu-print', cb),
  onExportPdf: (cb) => ipcRenderer.on('menu-export-pdf', cb),
  onToggleEditor: (cb) => ipcRenderer.on('menu-toggle-editor', cb),
  onSetViewMode: (cb) => ipcRenderer.on('menu-set-view-mode', (event, data) => cb(data)),

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

  // Remove listeners (cleanup)
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),

  // Is running inside Electron?
  isElectron: true,
});
