/**
 * AnyLloyd — Renderer Process Application Logic
 *
 * Handles:
 *  - Socket.io signaling connection to localhost:3000
 *  - Host flow: screen capture → WebRTC offer → stream to viewer
 *  - Viewer flow: receive stream → display video → relay mouse/keyboard back to host
 *
 * window.io       — provided by socket.io-client UMD script tag
 * window.electronAPI — provided by preload.js via contextBridge
 */

// ============================================================
// Socket connection
// ============================================================
// In dev (npm start) connect to local server; in packaged app connect to Render
const SIGNAL_SERVER = 'https://anylloyd-signaling.onrender.com';

const socket = io(SIGNAL_SERVER, { transports: ['websocket', 'polling'] });

// ============================================================
// DOM references
// ============================================================
const statusDot   = document.getElementById('status-dot');
const statusLabel = document.getElementById('status-label');

const homeScreen  = document.getElementById('home-screen');
const remoteView  = document.getElementById('remote-view');

// Host-side elements
const hostBtn           = document.getElementById('host-btn');
const stopHostBtn       = document.getElementById('stop-host-btn');
const sessionIdDisplay  = document.getElementById('session-id-display');
const sessionIdWrapper  = document.getElementById('session-id-wrapper');
const copyBtn           = document.getElementById('copy-btn');
const hostStatus        = document.getElementById('host-status');

// Viewer-side elements
const sessionInput  = document.getElementById('session-input');
const connectBtn    = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const viewerStatus  = document.getElementById('viewer-status');
const remoteVideo   = document.getElementById('remote-video');
const exitRemoteBtn = document.getElementById('exit-remote-btn');

// ============================================================
// State
// ============================================================
let hostPeerConn    = null;   // RTCPeerConnection (host side)
let viewerPeerConn  = null;   // RTCPeerConnection (viewer side)
let inputChannel    = null;   // RTCDataChannel for sending input events
let hostSocketId    = null;   // viewer stores the host's socket ID
let viewerSocketId  = null;   // host stores the viewer's socket ID
let localStream     = null;   // host's captured MediaStream
let screenSize      = { width: 1920, height: 1080 }; // cached host screen dimensions
let currentRole     = null;   // 'host' | 'viewer' | null
let inputListenersAttached = false; // guard against duplicate input listener attachment

const STUN_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' }
  ]
};

// ============================================================
// Helpers
// ============================================================

/** Update the global status indicator in the header */
function setStatus(state, text) {
  statusDot.className = `status-dot ${state}`;
  statusLabel.textContent = text;
}

/** Show/hide the home screen vs remote view */
function showRemoteView(visible) {
  homeScreen.style.display = visible ? 'none' : 'flex';
  remoteView.style.display = visible ? 'flex' : 'none';
}

/** Clean up WebRTC and media state */
function cleanup() {
  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (hostPeerConn) {
    hostPeerConn.close();
    hostPeerConn = null;
  }
  if (viewerPeerConn) {
    viewerPeerConn.close();
    viewerPeerConn = null;
  }
  inputChannel         = null;
  hostSocketId         = null;
  viewerSocketId       = null;
  currentRole          = null;
  inputListenersAttached = false; // allow re-attachment on the next viewer session
  remoteVideo.srcObject = null;
}

/** Map a DOM mouse button number to a robotjs button string */
function mapButton(btnNum) {
  if (btnNum === 2) return 'right';
  if (btnNum === 1) return 'middle';
  return 'left';
}

// ============================================================
// Socket event handlers
// ============================================================

socket.on('connect', () => {
  console.log('[socket] connected:', socket.id);
  setStatus('idle', 'Idle');
});

socket.on('connect_error', (err) => {
  console.error('[socket] connection error:', err.message);
  setStatus('disconnected', 'Server unreachable');
});

socket.on('disconnect', () => {
  console.warn('[socket] disconnected');
  setStatus('disconnected', 'Disconnected');
  cleanup();
  showRemoteView(false);
  resetHostUI();
  resetViewerUI();
});

socket.on('peer-disconnected', ({ reason }) => {
  console.warn('[socket] peer disconnected:', reason);
  setStatus('idle', 'Idle');
  cleanup();
  showRemoteView(false);
  resetHostUI();
  resetViewerUI();

  if (currentRole === 'host') {
    hostStatus.textContent = 'Viewer disconnected.';
  } else {
    viewerStatus.textContent = 'Host disconnected.';
  }
});

socket.on('join-error', ({ reason }) => {
  viewerStatus.textContent = `Error: ${reason}`;
  setStatus('idle', 'Idle');
  resetViewerUI();
});

// ============================================================
// HOST flow
// ============================================================

function resetHostUI() {
  hostBtn.style.display = '';
  stopHostBtn.style.display = 'none';
  sessionIdWrapper.style.display = 'none';
  sessionIdDisplay.textContent = '——————';
}

hostBtn.addEventListener('click', () => {
  currentRole = 'host';
  setStatus('hosting', 'Hosting');
  hostStatus.textContent = 'Registering with server…';
  socket.emit('host-register');
});

stopHostBtn.addEventListener('click', () => {
  cleanup();
  socket.emit('stop-hosting'); // server will handle graceful cleanup via disconnect
  socket.disconnect();
  socket.connect();
  resetHostUI();
  setStatus('idle', 'Idle');
  hostStatus.textContent = '';
});

/** Server assigned a session ID to this host */
socket.on('session-id', ({ sessionId }) => {
  console.log('[host] session ID:', sessionId);
  sessionIdDisplay.textContent = sessionId;
  sessionIdWrapper.style.display = 'flex';
  hostBtn.style.display = 'none';
  stopHostBtn.style.display = '';
  hostStatus.textContent = 'Waiting for viewer to connect…';
  setStatus('hosting', 'Hosting');
});

/** Copy session ID to clipboard */
copyBtn.addEventListener('click', () => {
  const id = sessionIdDisplay.textContent;
  navigator.clipboard.writeText(id).then(() => {
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  }).catch(() => {
    // Fallback for environments where clipboard API is restricted
    const el = document.createElement('textarea');
    el.value = id;
    document.body.appendChild(el);
    el.select();
    document.execCommand('copy');
    document.body.removeChild(el);
    copyBtn.textContent = 'Copied!';
    setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500);
  });
});

/** A viewer has joined — start WebRTC session as initiator */
socket.on('viewer-joined', async ({ viewerSocketId: vId }) => {
  console.log('[host] viewer joined:', vId);
  viewerSocketId = vId;
  hostStatus.textContent = 'Viewer connected — starting stream…';

  try {
    // 1. Get available screen sources
    const sources = await window.electronAPI.getSources();
    if (!sources || sources.length === 0) {
      throw new Error('No screen sources available');
    }

    // Pick the first screen source (primary monitor)
    const screenSource = sources.find((s) => s.name.toLowerCase().includes('screen')) || sources[0];
    console.log('[host] using source:', screenSource.name);

    // 2. Capture the screen as a MediaStream
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: screenSource.id,
          minWidth: 1280,
          maxWidth: 1920,
          minHeight: 720,
          maxHeight: 1080
        }
      }
    });

    // 3. Create RTCPeerConnection
    hostPeerConn = new RTCPeerConnection(STUN_SERVERS);

    // Add all stream tracks to the connection
    localStream.getTracks().forEach((track) => hostPeerConn.addTrack(track, localStream));

    // 4. Create a data channel for receiving viewer input events
    const dataChannel = hostPeerConn.createDataChannel('input');
    dataChannel.onopen = () => console.log('[host] data channel open');
    dataChannel.onmessage = async (e) => {
      try {
        const inputEvent = JSON.parse(e.data);
        await window.electronAPI.injectInput(inputEvent);
      } catch (err) {
        console.error('[host] input injection error:', err);
      }
    };

    // 5. ICE candidate handler — relay to viewer
    hostPeerConn.onicecandidate = (e) => {
      if (e.candidate) {
        socket.emit('signal', { to: viewerSocketId, data: { ice: e.candidate } });
      }
    };

    hostPeerConn.onconnectionstatechange = () => {
      console.log('[host] connection state:', hostPeerConn.connectionState);
      if (hostPeerConn.connectionState === 'connected') {
        hostStatus.textContent = 'Viewer connected and streaming.';
        setStatus('connected', 'Connected');
      } else if (hostPeerConn.connectionState === 'failed') {
        hostStatus.textContent = 'Connection failed — viewer may be behind a restrictive NAT or firewall.';
        setStatus('hosting', 'Hosting');
      } else if (['disconnected', 'closed'].includes(hostPeerConn.connectionState)) {
        hostStatus.textContent = 'Connection ended.';
        setStatus('hosting', 'Hosting');
      }
    };

    // 6. Create and send SDP offer to viewer
    const offer = await hostPeerConn.createOffer();
    await hostPeerConn.setLocalDescription(offer);
    socket.emit('signal', { to: viewerSocketId, data: { sdp: hostPeerConn.localDescription } });

    hostStatus.textContent = 'Offer sent — waiting for viewer…';

  } catch (err) {
    console.error('[host] error starting stream:', err);
    hostStatus.textContent = `Error: ${err.message}`;
    setStatus('hosting', 'Hosting');
  }
});

/** Receive signaling from viewer (answer SDP or ICE candidates) */
socket.on('signal', async ({ from, data }) => {
  if (currentRole === 'host' && hostPeerConn) {
    try {
      if (data.sdp) {
        await hostPeerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
        console.log('[host] set remote description (answer)');
      } else if (data.ice) {
        await hostPeerConn.addIceCandidate(new RTCIceCandidate(data.ice));
      }
    } catch (err) {
      console.error('[host] signaling error:', err);
    }
    return;
  }

  if (currentRole === 'viewer') {
    await handleViewerSignal(from, data);
  }
});

// ============================================================
// VIEWER flow
// ============================================================

function resetViewerUI() {
  connectBtn.style.display = '';
  disconnectBtn.style.display = 'none';
  sessionInput.disabled = false;
}

connectBtn.addEventListener('click', () => {
  const sessionId = sessionInput.value.trim();
  if (!/^\d{6}$/.test(sessionId)) {
    viewerStatus.textContent = 'Please enter a valid 6-digit session ID.';
    return;
  }

  currentRole = 'viewer';
  setStatus('connecting', 'Connecting…');
  viewerStatus.textContent = 'Connecting to session…';
  connectBtn.style.display = 'none';
  disconnectBtn.style.display = '';
  sessionInput.disabled = true;

  socket.emit('viewer-join', { sessionId });
});

disconnectBtn.addEventListener('click', () => {
  cleanup();
  showRemoteView(false);
  resetViewerUI();
  setStatus('idle', 'Idle');
  viewerStatus.textContent = 'Disconnected.';
});

exitRemoteBtn.addEventListener('click', () => {
  cleanup();
  showRemoteView(false);
  resetViewerUI();
  setStatus('idle', 'Idle');
  viewerStatus.textContent = 'Session ended.';
});

/** Server acknowledged viewer join — now wait for SDP offer from host */
socket.on('join-ack', ({ hostSocketId: hId }) => {
  console.log('[viewer] join acknowledged, host socket:', hId);
  hostSocketId = hId;
  viewerStatus.textContent = 'Waiting for host stream…';
  setStatus('connecting', 'Connecting…');
});

/**
 * Handle incoming signaling data when in viewer role.
 * Creates the RTCPeerConnection on first SDP offer, then handles ICE candidates.
 */
async function handleViewerSignal(from, data) {
  try {
    if (data.sdp && data.sdp.type === 'offer') {
      // First signal from host: create RTCPeerConnection and answer
      viewerPeerConn = new RTCPeerConnection(STUN_SERVERS);

      // Relay ICE candidates back to host
      viewerPeerConn.onicecandidate = (e) => {
        if (e.candidate) {
          socket.emit('signal', { to: hostSocketId, data: { ice: e.candidate } });
        }
      };

      viewerPeerConn.onconnectionstatechange = () => {
        console.log('[viewer] connection state:', viewerPeerConn.connectionState);
        if (viewerPeerConn.connectionState === 'connected') {
          viewerStatus.textContent = 'Connected.';
          setStatus('connected', 'Connected');
        } else if (viewerPeerConn.connectionState === 'failed') {
          setStatus('idle', 'Idle');
          viewerStatus.textContent = 'Connection failed — host may be behind a restrictive NAT or firewall.';
          showRemoteView(false);
          resetViewerUI();
        } else if (['disconnected', 'closed'].includes(viewerPeerConn.connectionState)) {
          setStatus('idle', 'Idle');
          viewerStatus.textContent = 'Connection ended.';
          showRemoteView(false);
          resetViewerUI();
        }
      };

      // Receive video track from host
      viewerPeerConn.ontrack = (e) => {
        console.log('[viewer] received track:', e.track.kind);
        if (e.streams && e.streams[0]) {
          remoteVideo.srcObject = e.streams[0];
          showRemoteView(true);
          viewerStatus.textContent = 'Streaming.';
          setStatus('connected', 'Connected');
          attachInputListeners();
        }
      };

      // Receive the input data channel created by the host
      viewerPeerConn.ondatachannel = (e) => {
        console.log('[viewer] received data channel:', e.channel.label);
        inputChannel = e.channel;
        inputChannel.onopen = () => console.log('[viewer] input channel open');
        inputChannel.onclose = () => console.log('[viewer] input channel closed');
      };

      // Process the SDP offer
      await viewerPeerConn.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await viewerPeerConn.createAnswer();
      await viewerPeerConn.setLocalDescription(answer);

      // Send answer back to host
      socket.emit('signal', { to: hostSocketId, data: { sdp: viewerPeerConn.localDescription } });
      console.log('[viewer] sent answer');

    } else if (data.ice && viewerPeerConn) {
      // ICE candidate from host
      await viewerPeerConn.addIceCandidate(new RTCIceCandidate(data.ice));
    }
  } catch (err) {
    console.error('[viewer] signaling error:', err);
    viewerStatus.textContent = `Signaling error: ${err.message}`;
  }
}

// ============================================================
// Input relay: viewer → host
// ============================================================

/**
 * Attach mouse and keyboard listeners to the remote video element.
 * Normalizes coordinates to percentages before sending over the data channel.
 */
async function attachInputListeners() {
  if (inputListenersAttached) return;
  inputListenersAttached = true;

  // Fetch host screen size once so we can denormalize on the host side
  try {
    screenSize = await window.electronAPI.getScreenSize();
    console.log('[viewer] host screen size:', screenSize);
  } catch (err) {
    console.warn('[viewer] could not get screen size, using default 1920×1080');
  }

  /** Send an event over the data channel if it is open */
  function sendInput(payload) {
    if (inputChannel && inputChannel.readyState === 'open') {
      inputChannel.send(JSON.stringify(payload));
    }
  }

  remoteVideo.addEventListener('mousemove', (e) => {
    const rect = remoteVideo.getBoundingClientRect();
    const xPct = (e.clientX - rect.left) / rect.width;
    const yPct = (e.clientY - rect.top) / rect.height;
    sendInput({
      type: 'mousemove',
      x: Math.round(xPct * screenSize.width),
      y: Math.round(yPct * screenSize.height)
    });
  });

  remoteVideo.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const rect = remoteVideo.getBoundingClientRect();
    sendInput({
      type: 'mousedown',
      x: Math.round(((e.clientX - rect.left) / rect.width) * screenSize.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * screenSize.height),
      button: mapButton(e.button)
    });
  });

  remoteVideo.addEventListener('mouseup', (e) => {
    e.preventDefault();
    const rect = remoteVideo.getBoundingClientRect();
    sendInput({
      type: 'mouseup',
      x: Math.round(((e.clientX - rect.left) / rect.width) * screenSize.width),
      y: Math.round(((e.clientY - rect.top) / rect.height) * screenSize.height),
      button: mapButton(e.button)
    });
  });

  // Keyboard events on the video element (needs to be focusable)
  remoteVideo.setAttribute('tabindex', '0');
  remoteVideo.addEventListener('keydown', (e) => {
    e.preventDefault();
    sendInput({ type: 'keydown', key: e.key.toLowerCase() });
  });
  remoteVideo.addEventListener('keyup', (e) => {
    e.preventDefault();
    sendInput({ type: 'keyup', key: e.key.toLowerCase() });
  });

  // Prevent context menu on right-click inside the remote view
  remoteVideo.addEventListener('contextmenu', (e) => e.preventDefault());
}
