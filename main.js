const { app, BrowserWindow, globalShortcut, ipcMain, session } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 400,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    focusable: true,
    type: 'panel',
    acceptFirstMouse: true,
    icon: path.join(__dirname, 'build-icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(false);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.loadFile('index.html');

  if (process.platform === 'darwin') app.dock.hide();

  ipcMain.on('set-overlay-mode', (_event, enable) => {
    if (!mainWindow) return;
    if (enable) {
      mainWindow.setFocusable(false);
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setFocusable(true);
      mainWindow.setIgnoreMouseEvents(false);
    }
  });

  ipcMain.on('hide-window', () => {
    if (mainWindow) mainWindow.hide();
  });

  ipcMain.on('quit-app', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'].includes(permission);
    callback(allowed);
  });

  createWindow();

  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (!mainWindow) return;
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.setFocusable(true);
      mainWindow.setIgnoreMouseEvents(false);
    } else if (!mainWindow.isFocusable()) {
      mainWindow.setFocusable(true);
      mainWindow.setIgnoreMouseEvents(false);
    } else {
      mainWindow.hide();
    }
  });
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
