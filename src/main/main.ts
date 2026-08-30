import path from 'node:path';
import { app, BrowserWindow, Menu, shell } from 'electron';
import { CodexAppServerManager } from './codex-app-server';
import { registerIpc } from './ipc';
import { WorkbenchStore } from './store';
import { TerminalManager } from './terminal-manager';
import {
  handleWindowShortcut,
  WORKBENCH_MIN_WINDOW_HEIGHT,
  WORKBENCH_MIN_WINDOW_WIDTH,
} from './window-behavior';

let mainWindow: BrowserWindow | null = null;
let disposeIpc: (() => void) | null = null;
let codex: CodexAppServerManager | null = null;
let terminals: TerminalManager | null = null;

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1520,
    height: 960,
    minWidth: WORKBENCH_MIN_WINDOW_WIDTH,
    minHeight: WORKBENCH_MIN_WINDOW_HEIGHT,
    show: false,
    backgroundColor: '#0a0d12',
    title: 'Workbench',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0d12',
      symbolColor: '#a9b1bd',
      height: 44,
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) {
      event.preventDefault();
      if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url);
    }
  });
  window.webContents.on('before-input-event', (event, input) => {
    if (handleWindowShortcut(window, input)) {
      event.preventDefault();
      return;
    }
    if (input.type === 'keyDown' && (input.key === 'F12' || (input.control && input.shift && input.key.toLowerCase() === 'i'))) {
      window.webContents.toggleDevTools();
    }
  });

  void window.loadFile(path.join(__dirname, '../../renderer/index.html'));
  return window;
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  mainWindow = createWindow();
  const store = new WorkbenchStore(path.join(app.getPath('userData'), 'workbench-state.json'));
  codex = new CodexAppServerManager();
  terminals = new TerminalManager(codex);
  disposeIpc = registerIpc({ window: mainWindow, store, codex, terminals });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      disposeIpc?.();
      disposeIpc = registerIpc({ window: mainWindow, store, codex: codex!, terminals: terminals! });
    }
  });
});

app.on('before-quit', () => {
  disposeIpc?.();
  terminals?.closeAll();
  codex?.stopAll();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
