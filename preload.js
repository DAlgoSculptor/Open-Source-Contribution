const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  setOverlayMode: (enable) => ipcRenderer.send('set-overlay-mode', enable),
  setInterviewMode: (enable) => ipcRenderer.send('set-interview-mode', enable),
  hideWindow: () => ipcRenderer.send('hide-window'),
  quitApp: () => ipcRenderer.send('quit-app'),
  onToggleRecording: (callback) => {
    // Remove any previous listener to avoid duplicates
    ipcRenderer.removeAllListeners('toggle-recording');
    ipcRenderer.on('toggle-recording', (_event) => callback());
  }
});
