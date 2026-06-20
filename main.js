const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  session,
  Tray,
  Menu,
  nativeImage
} = require('electron');
const path = require('path');

let mainWindow;
let tray;
let isInterviewMode = false;
let isRecordingShortcutRegistered = false;

const ICON_PATH = path.join(__dirname, 'build-icon.png');

function sendToRenderer(channel, ...args) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, ...args);
  }
}

function registerInterviewShortcuts() {
  if (isRecordingShortcutRegistered) return;
  try {
    globalShortcut.register('CommandOrControl+Shift+Space', () => {
      if (isInterviewMode) sendToRenderer('toggle-recording');
    });
  } catch (_) {}
  try {
    globalShortcut.register('CommandOrControl+Shift+M', () => {
      if (isInterviewMode) sendToRenderer('toggle-recording');
    });
  } catch (_) {}
  isRecordingShortcutRegistered = true;
}

function unregisterInterviewShortcuts() {
  if (!isRecordingShortcutRegistered) return;
  try { globalShortcut.unregister('CommandOrControl+Shift+Space'); } catch (_) {}
  try { globalShortcut.unregister('CommandOrControl+Shift+M'); } catch (_) {}
  isRecordingShortcutRegistered = false;
}

function setOverlayMode(enable) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (enable) {
    mainWindow.setFocusable(false);
    mainWindow.setIgnoreMouseEvents(true, { forward: true });
  } else {
    mainWindow.setFocusable(true);
    mainWindow.setIgnoreMouseEvents(false);
  }
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  if (!isInterviewMode) {
    mainWindow.setFocusable(true);
    mainWindow.setIgnoreMouseEvents(false);
    mainWindow.focus();
  }
}

function createTray() {
  let icon = nativeImage.createFromPath(ICON_PATH);
  if (icon.isEmpty()) icon = nativeImage.createEmpty();
  else icon = icon.resize({ width: 16, height: 16 });

  tray = new Tray(icon);
  tray.setToolTip('Angel – Interview Assistant');

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Show Overlay', click: showWindow },
    { type: 'separator' },
    { label: 'Quit', click: () => app.quit() }
  ]);

  tray.setContextMenu(contextMenu);
  tray.on('double-click', showWindow);
}

function createWindow() {
  const windowOptions = {
    width: 820,
    height: 500,
    minWidth: 500,
    minHeight: 200,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    resizable: true,
    focusable: true,
    show: false,
    acceptFirstMouse: true,
    icon: ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true
    }
  };

  // panel type is macOS-specific — only apply there
  if (process.platform === 'darwin') {
    windowOptions.type = 'panel';
  }

  mainWindow = new BrowserWindow(windowOptions);

  mainWindow.setContentProtection(true);
  mainWindow.setIgnoreMouseEvents(false);

  // setVisibleOnAllWorkspaces is only available on macOS and Linux
  if (process.platform !== 'win32') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  }

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  if (process.platform === 'darwin') {
    app.dock.hide();
  }
}

function registerIpcHandlers() {
  ipcMain.on('set-overlay-mode', (_event, enable) => {
    setOverlayMode(enable);
  });

  ipcMain.on('set-interview-mode', (_event, enable) => {
    isInterviewMode = enable;
    if (enable) {
      registerInterviewShortcuts();
      setOverlayMode(true);
    } else {
      unregisterInterviewShortcuts();
      setOverlayMode(false);
    }
  });

  ipcMain.on('hide-window', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide();
  });

  ipcMain.on('quit-app', () => {
    app.quit();
  });
}

app.whenReady().then(() => {
  // Grant microphone permission
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    const allowed = ['media', 'microphone', 'audioCapture'];
    callback(allowed.includes(permission));
  });

  session.defaultSession.setPermissionCheckHandler((_webContents, permission) => {
    return ['media', 'microphone', 'audioCapture'].includes(permission);
  });

  createWindow();
  createTray();
  registerIpcHandlers();

  // Global toggle shortcut
  globalShortcut.register('CommandOrControl+Shift+O', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (!mainWindow.isVisible()) {
      showWindow();
    } else if (isInterviewMode) {
      mainWindow.hide();
    } else {
      mainWindow.hide();
    }
  });
});

app.on('will-quit', () => {
  unregisterInterviewShortcuts();
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // Keep app running in tray on all platforms
});

app.on('activate', () => {
  if (!mainWindow || mainWindow.isDestroyed()) createWindow();
  else showWindow();
});
