/**
 * AnyLloyd — Electron Main Process
 * Creates the browser window and exposes IPC handlers for screen capture and input injection.
 * In packaged mode, also spawns the bundled signaling server as a child process.
 */

const { app, BrowserWindow, ipcMain, desktopCapturer, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');

// ── Bundled server launcher ─────────────────────────────────────────────────
let serverProcess = null;

/**
 * In development: the server is started manually by the user.
 * In production (packaged): spawn the bundled Node server from extraResources.
 * The server files land in  <resourcesPath>/server/index.js
 */
function startBundledServer() {
  if (!app.isPackaged) return; // dev mode — user starts server manually

  const serverDir  = path.join(process.resourcesPath, 'server');
  const serverFile = path.join(serverDir, 'index.js');

  // Use the Node binary that ships with Electron
  const nodeBin = process.execPath;

  console.log('[server] launching bundled server:', serverFile);
  serverProcess = spawn(nodeBin, [serverFile], {
    cwd: serverDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
  });

  serverProcess.stdout.on('data', (d) => console.log('[server]', d.toString().trim()));
  serverProcess.stderr.on('data', (d) => console.error('[server:err]', d.toString().trim()));
  serverProcess.on('exit', (code) => console.warn('[server] exited with code', code));
}

function stopBundledServer() {
  if (serverProcess) {
    serverProcess.kill();
    serverProcess = null;
  }
}

/**
 * Cache the robotjs require result at startup.
 * Avoids the overhead of a failing try/catch on every high-frequency inject-input call
 * when robotjs is not installed (e.g. missing native build tools on Windows).
 */
let robot = null;
try {
  robot = require('robotjs');
  console.log('[main] robotjs loaded successfully');
} catch (err) {
  console.warn('[main] robotjs unavailable — mouse/keyboard injection disabled:', err.message);
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Set Content-Security-Policy to allow WebSocket connections to the signaling server
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; " +
          "script-src 'self'; " +
          "style-src 'self' 'unsafe-inline'; " +
          "connect-src 'self' http://localhost:3000 ws://localhost:3000 wss://localhost:3000; " +
          "media-src 'self' blob: mediastream:; " +
          "img-src 'self' data: blob:"
        ]
      }
    });
  });
}

/**
 * IPC: get-sources
 * Returns an array of available screen/window capture sources.
 * Each item: { id, name, thumbnail (dataURL) }
 */
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 }
  });
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

/**
 * IPC: inject-input
 * Uses robotjs to replay mouse/keyboard events on the host machine.
 * Falls back gracefully if robotjs is not available (native build failed).
 * Input shape: { type, x, y, button, key }
 */
ipcMain.handle('inject-input', async (event, input) => {
  if (!robot) {
    return { ok: false, reason: 'robotjs unavailable' };
  }

  try {
    const { type, x, y, button, key } = input;

    switch (type) {
      case 'mousemove':
        robot.moveMouse(Math.round(x), Math.round(y));
        break;
      case 'mousedown':
        robot.mouseToggle('down', button || 'left');
        break;
      case 'mouseup':
        robot.mouseToggle('up', button || 'left');
        break;
      case 'keydown':
        if (key) robot.keyToggle(key, 'down');
        break;
      case 'keyup':
        if (key) robot.keyToggle(key, 'up');
        break;
      case 'keypress':
        if (key) robot.keyTap(key);
        break;
      default:
        console.warn('[inject-input] unknown event type:', type);
    }

    return { ok: true };
  } catch (err) {
    console.error('[inject-input] error:', err.message);
    return { ok: false, reason: err.message };
  }
});

/**
 * IPC: get-screen-size
 * Returns the primary display's screen dimensions.
 * Falls back to 1920×1080 if robotjs is unavailable.
 */
ipcMain.handle('get-screen-size', async () => {
  if (robot) {
    return robot.getScreenSize();
  }
  // Fallback when robotjs is not available
  const { screen } = require('electron');
  const display = screen.getPrimaryDisplay();
  return display.size;
});

app.whenReady().then(() => {
  startBundledServer();
  createWindow();

  app.on('activate', () => {
    // macOS: re-create window when dock icon is clicked and no windows are open
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Quit on all windows closed (except macOS)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopBundledServer();
});
