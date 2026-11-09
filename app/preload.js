/**
 * AnyLloyd — Preload Script
 * Exposes a safe, narrow API surface to the renderer via contextBridge.
 * No raw Node or Electron APIs are leaked to the renderer.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  /** Get available screen/window capture sources */
  getSources: () => ipcRenderer.invoke('get-sources'),

  /** Inject a mouse or keyboard input event on the host machine */
  injectInput: (input) => ipcRenderer.invoke('inject-input', input),

  /** Get the host screen resolution */
  getScreenSize: () => ipcRenderer.invoke('get-screen-size')
});
