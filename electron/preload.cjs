const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('musicSections', { lookupTitle: text => ipcRenderer.invoke('lookup-title', text), recognizeSong: input => ipcRenderer.invoke('recognize-song', input), timedLyrics: input => ipcRenderer.invoke('timed-lyrics', input), desktop: true });
