# AnyLloyd

A lightweight remote desktop application built with Electron, WebRTC, and Socket.io — inspired by AnyDesk.

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 18 or higher |
| npm | 9 or higher |
| Operating System | Windows, macOS, or Linux |
| Python (optional) | 3.x — needed only to compile robotjs for input injection |
| Visual C++ Build Tools (Windows, optional) | For robotjs native build |

---

## Install (development)

### 1. Signaling server dependencies

```bash
cd server
npm install
```

### 2. Electron app dependencies

```bash
cd ../app
npm install
```

> **Note:** After `npm install`, you may optionally attempt to rebuild robotjs against Electron's Node ABI:
> ```bash
> npx electron-rebuild -f -w robotjs
> ```
> If this fails (common on Windows without Visual C++ Build Tools), the app continues to work normally — mouse/keyboard injection will simply be disabled.

---

## Build a Windows Installer

Run the build script from the workspace root (PowerShell):

```powershell
.\build.ps1
```

This will:
1. Install all dependencies
2. Generate the app icon (`app/assets/icon.ico`)
3. Run `electron-builder` to produce two artifacts in `dist/`:
   - `AnyLloyd Setup 1.0.0.exe` — NSIS installer with Start Menu shortcut, custom install path, and uninstaller
   - `AnyLloyd-1.0.0-portable.exe` — single-file portable executable, no installation needed

Or run each step manually:

```bash
# From app/
npm run dist          # both NSIS installer + portable
npm run dist:nsis     # NSIS installer only
npm run dist:portable # portable .exe only
```

> **Important:** Before building, generate the icon once:
> ```bash
> node app/scripts/make-icon.js
> ```

The packaged app automatically starts the bundled signaling server on launch — end users do **not** need Node.js installed.

---

## Run (development)

### Step 1 — Start the signaling server

Open a terminal in the `server/` directory:

```bash
cd server
npm start
```

Expected output: `Signaling server running on port 3000`

### Step 2 — Start the Electron app

Open a **second** terminal in the `app/` directory:

```bash
cd app
npm start
```

The AnyLloyd window will open.

---

## How to Use

### Host Mode (share your screen)

1. In the AnyLloyd window, click **Start Hosting**.
2. A 6-digit session ID will appear (e.g. `483921`).
3. Share this ID with the person who wants to view your screen.
4. When they connect, your screen stream starts automatically.

### Viewer Mode (connect to a remote screen)

1. Obtain the host's 6-digit session ID.
2. Type it into the "Remote Computer" input field.
3. Click **Connect**.
4. The host's screen appears in the viewer window.
5. Move your mouse over the video — mouse and keyboard events are relayed to the host machine (requires robotjs on the host).

---

## Known Limitations

- **robotjs native binding**: On some platforms — especially Windows without Visual C++ Build Tools — robotjs may fail to compile. In this case the app falls back gracefully: video streaming still works, but remote mouse/keyboard injection is disabled. To enable it, install the build tools and run `npm rebuild robotjs` inside `app/`.

- **Same-network P2P**: AnyLloyd uses Google STUN servers for NAT traversal. P2P works best on the same local network or with simple NAT. For connections across restrictive NATs or firewalls, a TURN relay server would be needed (not included in v1).

- **No audio streaming**: v1 streams video only. Audio capture and streaming is not implemented.

- **Single viewer**: Each session supports one host and one viewer at a time.

- **Port 3000**: The signaling server listens on port 3000. If another process is using that port, edit the `PORT` constant in `server/index.js` and the `io(...)` URL in `app/renderer/app.js`.

- **Screen capture constraints**: The screen capture call uses the legacy Chromium `mandatory` constraint syntax (`chromeMediaSource`, `chromeMediaSourceId`). This works correctly in Electron 28 (Chromium 120) but has been progressively deprecated in newer Chromium versions. If upgrading Electron beyond v28, test screen capture and migrate to the standard constraint form if it stops working.

---

## Architecture

AnyLloyd consists of three parts: a Node.js/Express signaling server (Socket.io) that brokers connections between peers, an Electron main process that captures the screen via `desktopCapturer` and injects input via robotjs, and a renderer process (plain HTML/CSS/JS) that handles the UI, initiates the WebRTC peer connection using the browser's native `RTCPeerConnection` API, and forwards user input events over an RTCDataChannel back to the host.
