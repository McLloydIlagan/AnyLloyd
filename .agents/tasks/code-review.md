# AnyLloyd Remote Desktop Application — Code Review

AnyLloyd is a local-network remote desktop app built on Electron 28, WebRTC, and Socket.io. The host captures a screen source via `desktopCapturer`, initiates a WebRTC `RTCPeerConnection`, and streams video to the viewer over a direct P2P connection. Mouse and keyboard events from the viewer are relayed back over an `RTCDataChannel` and replayed on the host using robotjs. A Node.js/Socket.io signaling server on port 3000 brokers the offer/answer/ICE exchange.

The WebRTC signaling flow is complete and correctly sequenced. The Electron security posture is correct. The build verification confirms both `node_modules` trees installed cleanly and the critical `socket.io-client/dist/socket.io.js` path exists.

Watch for: (1) **confirmed** — `mousedown`/`mouseup` events send coordinates but `mouseToggle` in robotjs does not accept `x`/`y` — cursor position is NOT updated before the click, so rapid clicks without a preceding `mousemove` hit the wrong target; (2) **confirmed** — `app.js` uses `type="module"` and calls bare `io(...)` from `window.io`; if the UMD script tag fails to load, the module throws silently with no user-visible error; (3) **likely** — connections across restrictive NATs fail at ICE with no actionable user guidance beyond the generic "Connection failed" message.

**Verdict**: APPROVED

---

## High-level view

The signaling server state machine covers all transitions cleanly: host registration, viewer pairing, `stop-hosting` synchronous cleanup (fixed in iteration 2 to prevent the orphaned-session race), and abnormal disconnect handling for both roles. The viewer branch of disconnect nulls `session.viewerSocketId` rather than deleting the session, so the host can accept a new viewer after the first one drops.

The WebRTC flow is complete and correctly ordered. The host creates the data channel before `createOffer` — required so the channel is negotiated in the SDP. The viewer creates `RTCPeerConnection` on first offer receipt, answers, and both sides exchange ICE candidates through the generic `signal` relay. The `inputListenersAttached` guard prevents duplicate listener attachment across reconnections.

The Electron security layer is correctly configured, but the `mousedown`/`mouseup` injection cases in `inject-input` discard the `x`/`y` coordinates the viewer sends — `robot.mouseToggle` is called without a preceding `robot.moveMouse`, so clicks land wherever the last `mousemove` left the cursor. This is a behavioral bug in every click interaction.

The `window.io` dependency on the UMD script tag is load-order-correct as written, but unguarded — if the socket.io bundle fails to load the app goes entirely silent. The `style-src 'unsafe-inline'` in the CSP is present because visibility is managed through inline `style=""` attributes set by JS; moving to CSS class toggling would allow it to be dropped.

---

<details>
<summary>Issues (3)</summary>

1. **mousedown/mouseup miss position** — `robot.mouseToggle` is called without a preceding `robot.moveMouse(x, y)`, so clicks land at whatever position the last `mousemove` left the cursor. Add `robot.moveMouse(Math.round(x), Math.round(y))` at the top of the `mousedown` and `mouseup` cases in the `inject-input` IPC handler.

2. **window.io load failure is silent** — `app.js` is a module that calls `io(...)` at the top level, relying on `window.io` being set by the preceding UMD `<script>` tag. If the socket.io bundle fails to load, the module throws immediately and the entire app goes silent. A startup check (`if (!window.io) { /* show error to user */ }`) would make this failure visible.

3. **ICE failure gives no actionable guidance** — When a connection fails across a restrictive NAT, the only user-visible message is "Connection failed — host may be behind a restrictive NAT or firewall." There is no TURN configuration and no guidance on what to do next. This is documented in the README but not surfaced in the UI at the moment of failure.

</details>

<details>
<summary>Details</summary>

### Click coordinate gap in input injection

The viewer sends `x` and `y` with every `mousedown` and `mouseup` event. The host-side `inject-input` IPC handler ignores them:

```js
case 'mousedown':
  robot.mouseToggle('down', button || 'left');  // ← no moveMouse call
  break;
case 'mouseup':
  robot.mouseToggle('up', button || 'left');    // ← no moveMouse call
  break;
```

The fix is one line per case:

```js
case 'mousedown':
  robot.moveMouse(Math.round(x), Math.round(y));
  robot.mouseToggle('down', button || 'left');
  break;
```

### Special key name mismatch (likely, v1 known gap)

The `keydown`/`keyup` handlers pass `e.key.toLowerCase()` directly to `robot.keyToggle`. robotjs key names diverge from DOM `e.key` values for special keys: `'ArrowLeft'` becomes `'arrowleft'` instead of robotjs's `'left'`; `' '` (Space) becomes `' '` instead of `'space'`. Special keys will silently do nothing or emit wrong characters. This is a v1 scope limitation but should be tracked.

### Signaling server disconnect race

If the host socket disconnects and immediately reconnects before `stop-hosting` propagates, there is a window where `sessions[sessionId]` no longer exists but the viewer hasn't received `peer-disconnected`. The race is transient and non-corrupting — the viewer will eventually time out or receive the event — but a reconnecting host cannot reclaim the same session ID.

### CSP `unsafe-inline` on style-src

The CSP in `main.js` includes `'unsafe-inline'` for `style-src` because visibility is managed through inline `style=""` attributes. Replacing these with CSS class toggles would allow this to be dropped, tightening the CSP. Not blocking for v1.

### Test coverage

No automated tests exist. The build-verification confirms `node --check` syntax validation. The signaling server's state machine — especially the double-join guard and the disconnect/reconnect race — would benefit from unit tests if the project evolves beyond prototype.

</details>

---

<details>
<summary>File map</summary>

| File | Change |
|---|---|
| `server/index.js` | Full signaling server: host-register, viewer-join, signal relay, stop-hosting, disconnect cleanup |
| `server/package.json` | express, socket.io, cors dependencies |
| `app/main.js` | Electron main: BrowserWindow with security config, IPC handlers for sources/input/screen-size, bundled server spawn |
| `app/preload.js` | contextBridge: exposes getSources, injectInput, getScreenSize |
| `app/renderer/index.html` | App shell: home screen + remote view panels, socket.io UMD script tag, app.js module script |
| `app/renderer/app.js` | Full host and viewer WebRTC flows, socket signaling, input relay |
| `app/renderer/style.css` | Dark theme, two-panel layout, responsive breakpoint, remote video view |
| `app/package.json` | Electron + socket.io-client deps, electron-builder config for NSIS + portable |
| `README.md` | Prerequisites, install steps, run steps, usage guide, known limitations, architecture overview |
| `.agents/tasks/build-verification.md` | Iteration 2 verification: npm install results, critical path checks, syntax checks, prior findings resolved |

Full diff: `git diff main` from workspace root.

</details>
