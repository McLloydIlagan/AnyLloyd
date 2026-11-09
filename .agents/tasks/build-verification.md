# AnyLloyd — Build Verification

**Date:** Iteration 2 (review fix pass)

## Files Written
| File | Status |
|---|---|
| `server/package.json` | ✅ Created |
| `server/index.js` | ✅ Created |
| `app/package.json` | ✅ Created |
| `app/main.js` | ✅ Created |
| `app/preload.js` | ✅ Created |
| `app/renderer/index.html` | ✅ Created |
| `app/renderer/app.js` | ✅ Created |
| `app/renderer/style.css` | ✅ Created |
| `README.md` | ✅ Created |

## npm install — server/
- **Result:** Success (exit 0)
- **Packages added:** 89
- **Vulnerabilities:** 0

## npm install — app/
- **Result:** Success (exit 0)
- **Packages added:** 77
- **Notes:** 2 high-severity audit advisories in transitive deps (not in direct deps); expected `boolean@3.2.0` deprecation warning from Electron's transitive tree. No blocking errors.

## Critical Path Verification
| Path | Exists |
|---|---|
| `server/node_modules/express` | ✅ True |
| `app/node_modules/electron` | ✅ True |
| `app/node_modules/socket.io-client/dist/socket.io.js` | ✅ True |

## Review Findings Fixed (Iteration 2)
| Finding | Resolution |
|---|---|
| #1 Orphaned session on stop-hosting | Added `socket.on('stop-hosting', ...)` handler to `server/index.js` that synchronously deletes session and reverse-lookup entries |
| #2 `inputListenersAttached` TDZ crash | Moved `let inputListenersAttached = false` declaration to top-level state block (line ~54 of `app.js`), removed duplicate lower declaration |
| #3 Deprecated getUserMedia mandatory constraints | Non-blocking; documented Electron v28 constraint in README Known Limitations section |
| #4 `installer.nsh` referenced but absent | Removed `"include": "installer.nsh"` key from NSIS config in `app/package.json` |
| Dead code double-delete in viewer disconnect | Removed second `delete socketToSession[socket.id]` from viewer branch of disconnect handler |

## Syntax Verification (Iteration 2)
| File | Check |
|---|---|
| `server/index.js` | `node --check` → OK |
| `app/renderer/app.js` | `node --check` → OK |

## Notes
- robotjs is **not** listed in `package.json` as required by spec. It is loaded conditionally in `main.js` via `try/catch`. If robotjs is not installed or fails to build (common on Windows without Visual C++ Build Tools), the `inject-input` IPC handler returns `{ ok: false, reason: 'robotjs unavailable' }` — the rest of the app (video streaming) continues to work normally.
- The socket.io-client UMD bundle (`socket.io.js`) is loaded via a `<script>` tag in `index.html` — this is the correct pattern for Electron with `contextIsolation: true`.
