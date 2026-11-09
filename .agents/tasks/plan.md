# AnyLloyd — Implementation Plan

## Environment Notes (Windows-specific)

- **Node.js**: v24.22.0, npm 11.19.1
- **Python**: 3.11.9 available as `python` (needed for robotjs native build via node-gyp)
- **MSVC / MSBuild**: not detected on PATH. robotjs requires Visual C++ build tools.
  If `npm install` for robotjs fails, the app gracefully falls back to a no-op IPC handler
  with a console warning — the app still runs, mouse/keyboard injection is simply skipped.
- **Electron version**: ^28.0.0 (latest stable is 45.x at plan time; 28 is requested; use 28).
- **electron-rebuild**: use `electron-rebuild` after `npm install` in the `app/` folder to
  recompile robotjs against Electron's Node ABI. If rebuild fails, catch the error and continue.
- **simple-peer**: last published 9.11.1. Ships pre-built JS; no native compilation needed.
- **socket.io-client**: pure JS — no native build.
- The workspace root `c:\Users\LloydIlagan\Desktop\AnyLloyd` is currently empty (no existing
  files to preserve).

---

## Implementation Plan

- [ ] 1. Scaffold the directory structure and `package.json` files.

  Create the full folder tree and both `package.json` files with exact dependency versions.
  No source code yet — just the manifests needed so `npm install` can run next.

  **Decision**: pin exact minor versions as specified in the spec
  (`express ^4.18.2`, `socket.io ^4.7.2`, `cors ^2.8.5`, `electron ^28.0.0`,
  `socket.io-client ^4.7.2`, `simple-peer ^9.11.1`, `robotjs ^0.6.0`).
  Add `electron-rebuild ^3.2.9` as a devDependency in the app and an `"rebuild"` npm script.

  Files to create:
  - `server/package.json`
  - `app/package.json`
  - `app/renderer/` directory (empty, populated in later steps)

  Verify: `Test-Path server\package.json` and `Test-Path app\package.json` both return `True`.

---

- [ ] 2. Install server dependencies.

  Run `npm install` inside `server/`. Confirm `node_modules/express`, `node_modules/socket.io`,
  and `node_modules/cors` are present.

  Files modified: `server/node_modules/` (generated), `server/package-lock.json` (generated)

  Verify:
  ```
  cd server && npm install
  ```
  Expected: exits 0, no peer-dependency errors.

---

- [ ] 3. Install app dependencies and attempt robotjs rebuild.

  Run `npm install` inside `app/`. Then run `npx electron-rebuild -f -w robotjs` to recompile
  robotjs against Electron 28's ABI. If electron-rebuild fails (missing MSVC), print the error,
  add `"robotjsAvailable": false` comment to `main.js`'s IPC handler, and continue — do not
  abort the plan.

  Files modified: `app/node_modules/` (generated), `app/package-lock.json` (generated)

  Verify:
  ```
  cd app && npm install
  ```
  Expected: exits 0. electron-rebuild may exit non-zero on Windows without build tools — that is
  acceptable; note it in findings and proceed.

---

- [ ] 4. Write the signaling server (`server/index.js`).

  Full implementation of the Socket.io signaling server:
  - Express app with CORS (origin `*` for local dev).
  - On `connection`: generate a random 6-digit session ID, store `sessions` map
    `{ sessionId → { hostSocket, viewerSocket|null } }`.
  - On `host-register`: assign session ID to the connecting socket, emit
    `session-id { sessionId }` back to host.
  - On `viewer-join { sessionId }`: look up host socket, pair viewer, emit
    `viewer-joined { sessionId }` to host.
  - On `signal { to, data }`: relay `data` to socket `to` as `signal { from, data }`.
  - On `disconnect`: remove socket from sessions map; notify paired peer with `peer-disconnected`.
  - Listen on port 3000.

  Every non-trivial block must have a JSDoc-style comment explaining its role.

  Files to create:
  - `server/index.js`

  Verify:
  ```
  cd server && node index.js
  ```
  Expected: console prints `Signaling server running on port 3000`, process stays alive.
  Kill with Ctrl-C after confirming.

---

- [ ] 5. Write the Electron main process (`app/main.js`).

  Full implementation:
  - `BrowserWindow` with `nodeIntegration: false`, `contextIsolation: true`,
    `preload: path.join(__dirname, 'preload.js')`.
  - Window size 1000×700, resizable. Load `renderer/index.html`.
  - IPC handler `get-sources`: calls `desktopCapturer.getSources({ types: ['screen','window'] })`
    and returns the array of `{ id, name, thumbnail }` objects (thumbnail as dataURL).
  - IPC handler `inject-input { type, x, y, button, key }`:
    - Attempts `require('robotjs')`. If robotjs is unavailable (native build failed), logs a
      warning and returns `{ ok: false, reason: 'robotjs unavailable' }` — no crash.
    - For type `mousemove`: `robot.moveMouse(x, y)`.
    - For type `mousedown`/`mouseup`: `robot.mouseToggle(type==='mousedown'?'down':'up', button||'left')`.
    - For type `keydown`: `robot.keyToggle(key, 'down')`.
    - For type `keyup`: `robot.keyToggle(key, 'up')`.
  - IPC handler `get-screen-size`: returns `{ width, height }` from `screen.getPrimaryDisplay().size`.
  - App lifecycle: `app.whenReady()`, single-instance guard, graceful quit on all-windows-closed
    (except macOS).

  Files to create:
  - `app/main.js`

  Verify: running `cd app && npx electron .` must open the window without any uncaught errors
  in the main-process terminal output.

---

- [ ] 6. Write the preload script (`app/preload.js`).

  Expose a safe `window.api` object via `contextBridge.exposeInMainWorld`:
  - `getSources()` → invokes `ipcRenderer.invoke('get-sources')`
  - `injectInput(payload)` → invokes `ipcRenderer.invoke('inject-input', payload)`
  - `getScreenSize()` → invokes `ipcRenderer.invoke('get-screen-size')`

  No other Node or Electron APIs are exposed to the renderer.

  Files to create:
  - `app/preload.js`

  Verify: included automatically when `npx electron .` is run in step 5's verification.

---

- [ ] 7. Write the renderer HTML (`app/renderer/index.html`).

  Full page structure:
  - `<head>`: charset, viewport meta, title "AnyLloyd", link to `style.css`.
  - `<body>`: two views toggled by a CSS class on `<body>`:
    1. **Home view** (`#home-view`): app title, two large buttons — "Host" and "Viewer".
    2. **Host view** (`#host-view`):
       - Session ID display `<span id="session-id">` in large monospace font.
       - "Copy" button next to it.
       - Status line `<p id="host-status">`.
       - "Stop Hosting" button.
    3. **Viewer view** (`#viewer-view`):
       - Input `<input id="session-input" maxlength="6" placeholder="Enter 6-digit ID">`.
       - "Connect" button.
       - Status line `<p id="viewer-status">`.
       - `<video id="remote-video" autoplay playsinline>` (hidden until stream arrives).
       - "Disconnect" button.
  - Script tag loading `app.js` at end of body.

  Files to create:
  - `app/renderer/index.html`

  Verify: included in Electron launch from step 5.

---

- [ ] 8. Write the renderer stylesheet (`app/renderer/style.css`).

  Dark theme:
  - Background `#1e1e1e`, surface `#2a2a2a`, text `#e0e0e0`.
  - Accent green `#00c853`.
  - Session ID `<span>`: font-family monospace, font-size 2.5rem, letter-spacing 0.2em,
    color accent green, padding 0.5rem 1rem, background `#111`, border-radius 8px.
  - Buttons: background accent green, color `#000`, border-radius 6px, padding 0.6rem 1.4rem,
    font-weight 600, no border, cursor pointer. Hover: brightness 1.1.
  - Input fields: background `#333`, color `#e0e0e0`, border `1px solid #555`,
    border-radius 6px, padding 0.5rem 0.8rem.
  - Two-panel home layout: flexbox column, centered, gap 1.5rem.
  - `#remote-video`: width 100%, max-height calc(100vh - 120px), object-fit contain,
    background `#000`, hidden by default (`display: none`), shown when stream active.
  - View transitions: hide/show via `display: none` / `display: flex`.

  Files to create:
  - `app/renderer/style.css`

  Verify: included in Electron launch from step 5.

---

- [ ] 9. Write the renderer application logic (`app/renderer/app.js`).

  This is the largest and most critical file. Full implementation, no stubs.

  **Socket.io setup**
  - Connect to `http://localhost:3000` using socket.io-client (loaded as a script or via the
    `simple-peer` bundle; socket.io-client is available as `window.io` if loaded via a `<script>`
    tag pointing to `../node_modules/socket.io-client/dist/socket.io.js`).
  - Add a `<script src="../node_modules/socket.io-client/dist/socket.io.js">` tag to `index.html`
    (update step 7's file accordingly) and a `<script src="../node_modules/simple-peer/simplepeer.min.js">`.

  **View management**
  - `showView(name)`: sets `document.body.dataset.view = name`, hides/shows sections.

  **Host flow**
  1. On "Host" button click: emit `host-register` to signaling server.
  2. On `session-id { sessionId }` from server: display ID, update status "Waiting for viewer…".
  3. On `viewer-joined { sessionId }` from server:
     a. Call `window.api.getSources()` to get screen sources.
     b. Use `navigator.mediaDevices.getUserMedia` with the chromeMediaSourceId constraint to
        capture the primary screen as a `MediaStream`.
     c. Create a `SimplePeer({ initiator: true, trickle: true, stream })`.
     d. On peer `signal`: emit `signal { to: viewerSocketId, data }` to signaling server.
     e. On peer `connect`: update host status "Viewer connected".
     f. On peer `data`: parse JSON, call `window.api.injectInput(payload)`.
     g. On peer `close`/`error`: cleanup.
  4. On `signal { from, data }` from server (ICE from viewer): `peer.signal(data)`.

  **Viewer flow**
  1. On "Connect" button click: read session ID input, emit `viewer-join { sessionId }`.
  2. On `viewer-joined` confirmation back (server echoes to viewer too): update status "Connecting…".
  3. On `signal { from, data }` from server (SDP offer + ICE from host):
     a. If no peer yet, create `SimplePeer({ initiator: false, trickle: true })`.
     b. Call `peer.signal(data)`.
     c. On peer `signal`: emit `signal { to: hostSocketId, data }` back.
     d. On peer `stream`: set `remoteVideo.srcObject = stream`, show video element.
     e. On peer `connect`: update viewer status "Connected".
     f. On peer `close`/`error`: cleanup.
  4. Mouse/keyboard relay:
     - Attach `mousemove`, `mousedown`, `mouseup`, `keydown`, `keyup` listeners to `<video>`.
     - On each event: compute normalized coords (x / video.offsetWidth, y / video.offsetHeight
       for mouse; key string for keyboard).
     - Send `peer.send(JSON.stringify({ type, x, y, button, key }))` only when data channel open.

  **Mouse coordinate normalization**
  - Viewer sends `{ type, xPct, yPct, button, key }` where `xPct = event.offsetX / video.offsetWidth`.
  - Host IPC `inject-input` receives `{ type, x: xPct * screenWidth, y: yPct * screenHeight }`.
  - Call `window.api.getScreenSize()` once on viewer-connect and cache width/height.

  **Error handling**
  - All async operations wrapped in try/catch; errors displayed in status lines, never silently swallowed.
  - Socket disconnect: reset UI to home view, alert user.

  Files to create:
  - `app/renderer/app.js`
  Also update:
  - `app/renderer/index.html` (add the two `<script>` tags for socket.io-client and simple-peer)

  Verify: run `node server/index.js` in one terminal, then `cd app && npx electron .` in another.
  - Home view renders correctly.
  - Clicking "Host" shows a 6-digit session ID in the host view.
  - Clicking "Viewer", entering the ID, and clicking "Connect" triggers the WebRTC handshake
    (observe `offer`, `answer`, and ICE candidate log lines in the server terminal).
  - Screen stream appears in the viewer window.

---

- [ ] 10. Write the root `README.md`.

  Document:
  - What AnyLloyd is.
  - Prerequisites (Node ≥18, Python for robotjs, Windows Visual C++ Build Tools optional).
  - How to install: `cd server && npm install`, `cd app && npm install && npx electron-rebuild -f -w robotjs`.
  - How to run: start server, then start app.
  - robotjs Windows note: if electron-rebuild fails, mouse/keyboard injection is disabled but
    the rest of the app works.
  - Architecture overview (one paragraph).

  Files to create:
  - `README.md`

  Verify: file exists and is readable. No build step needed.

---

## Dependency and Order Summary

```
Step 1  (scaffolding)
  └─> Step 2  (server npm install)
  └─> Step 3  (app npm install + electron-rebuild)
        └─> Step 4  (server/index.js)  ← needs node_modules in server/
        └─> Step 5  (app/main.js)      ← needs electron in app/node_modules
        └─> Step 6  (app/preload.js)   ← references main.js IPC channels
        └─> Step 7  (index.html)       ← skeleton; updated in step 9
        └─> Step 8  (style.css)
        └─> Step 9  (app.js + index.html update)  ← depends on 4,5,6,7,8
              └─> Step 10 (README)
```

Steps 4–8 are independent of each other (same dependency level) and can be written in any order,
but all must be complete before the end-to-end verification in step 9.

---

## Windows-Specific Notes

### robotjs native build
- robotjs 0.6.x uses node-gyp, which requires:
  - Python (`python` on PATH — confirmed present: 3.11.9)
  - Visual C++ Build Tools (not detected). Install via:
    `npm install --global windows-build-tools` (Node <16) or
    `winget install Microsoft.VisualStudio.2022.BuildTools` + Desktop C++ workload.
- If the build fails, `require('robotjs')` in `main.js` is wrapped in a try/catch. The IPC
  handler returns `{ ok: false, reason: 'robotjs unavailable' }` and logs a warning. The app
  continues to work — only remote input injection is disabled.
- **Do not block the install step on this failure.** Use `npm install --ignore-scripts` as a
  fallback if the script-driven build hangs.

### Electron desktopCapturer
- `desktopCapturer.getSources` works without additional OS permissions on Windows (unlike macOS
  which requires Screen Recording permission).
- The chromeMediaSourceId constraint used in `getUserMedia` is Electron-specific and requires
  the call to happen in the renderer process (confirmed pattern for Electron 28).

### Socket.io-client in renderer
- Because `nodeIntegration: false`, we cannot `require('socket.io-client')` in the renderer.
- Instead, load the pre-bundled UMD file directly via `<script>` tag:
  `../node_modules/socket.io-client/dist/socket.io.js` — exposes `window.io`.
- Same approach for simple-peer: `../node_modules/simple-peer/simplepeer.min.js` — exposes
  `window.SimplePeer`.

### Port conflicts
- Server runs on port 3000. If another process is using 3000, change the port in both
  `server/index.js` and `app/renderer/app.js`.

### File paths in Electron
- All `require()` / `path.join(__dirname, ...)` calls in `main.js` use Windows-safe `path.join`.
- `__dirname` in `main.js` resolves to `app/`, so `path.join(__dirname, 'preload.js')` and
  `path.join(__dirname, 'renderer', 'index.html')` are correct.
