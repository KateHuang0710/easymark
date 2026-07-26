const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', Object.freeze({
  platform: process.platform,
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),
  onBeforeClose: callback => {
    const handler = () => callback()
    ipcRenderer.on('app-before-close', handler)
    return () => ipcRenderer.removeListener('app-before-close', handler)
  },
  confirmClose: () => ipcRenderer.send('app-close-confirmed'),
  cancelClose: () => ipcRenderer.send('app-close-cancelled'),
  readClipboardText: () => ipcRenderer.invoke('clipboard:readText'),
  writeClipboardText: text => ipcRenderer.invoke('clipboard:writeText', text),
  listNotes: () => ipcRenderer.invoke('notes:list'),
  readNote: filename => ipcRenderer.invoke('notes:read', filename),
  saveNote: (filename, content) => ipcRenderer.invoke('notes:save', filename, content),
  listNoteVersions: filename => ipcRenderer.invoke('notes:listVersions', filename),
  readNoteVersion: (filename, versionId) => ipcRenderer.invoke('notes:readVersion', filename, versionId),
  restoreNoteVersion: (filename, versionId) => ipcRenderer.invoke('notes:restoreVersion', filename, versionId),
  createNote: title => ipcRenderer.invoke('notes:create', title),
  deleteNote: filename => ipcRenderer.invoke('notes:delete', filename),
  renameNote: (oldFilename, newTitle) => ipcRenderer.invoke('notes:rename', oldFilename, newTitle),
  saveImage: dataUrl => ipcRenderer.invoke('file:saveImage', dataUrl),
  openHelp: locale => ipcRenderer.invoke('help:open', locale),
  onMaximizedChanged: callback => {
    const handler = (_event, maximized) => callback(Boolean(maximized))
    ipcRenderer.on('window-maximized-changed', handler)
    return () => ipcRenderer.removeListener('window-maximized-changed', handler)
  },
  searchAllNotes: query => ipcRenderer.invoke('notes:searchAll', query),
  exportPDF: (html, title) => ipcRenderer.invoke('export:pdf', html, title),
  exportDOCX: (markdown, title) => ipcRenderer.invoke('export:docx', markdown, title),
  getAIConfig: () => ipcRenderer.invoke('ai:getConfig'),
  configureAI: config => ipcRenderer.invoke('ai:configure', config),
  clearAIKey: () => ipcRenderer.invoke('ai:clearKey'),
  listAIModels: config => ipcRenderer.invoke('ai:listModels', config),
  chatWithAI: (messages, options) => ipcRenderer.invoke('ai:chat', messages, options),
}))
