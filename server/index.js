/**
 * AnyLloyd Signaling Server
 * Node.js + Express + Socket.io — relays WebRTC offer/answer/ICE between host and viewer.
 * Port: 3000
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();

/** Allow all origins for local development */
app.use(cors({ origin: '*' }));

const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

/**
 * sessions: Map<sessionId, { hostSocketId: string, viewerSocketId: string|null }>
 * Tracks active hosting sessions. Session IDs are 6-digit numeric strings.
 */
const sessions = {};

/**
 * socketToSession: Map<socketId, { sessionId, role: 'host'|'viewer' }>
 * Reverse-lookup so disconnect can clean up the correct session.
 */
const socketToSession = {};

/** Generate a random 6-digit numeric session ID that is not already in use */
function generateSessionId() {
  let id;
  do {
    id = String(Math.floor(100000 + Math.random() * 900000));
  } while (sessions[id]);
  return id;
}

io.on('connection', (socket) => {
  console.log(`[connect] socket ${socket.id}`);

  /**
   * host-register: called by the host client to start a new session.
   * Generates a unique 6-digit ID and stores the host socket.
   * Responds with { sessionId } so the host can display it to the user.
   */
  socket.on('host-register', () => {
    const sessionId = generateSessionId();
    sessions[sessionId] = { hostSocketId: socket.id, viewerSocketId: null };
    socketToSession[socket.id] = { sessionId, role: 'host' };
    console.log(`[host-register] session ${sessionId} → host ${socket.id}`);
    socket.emit('session-id', { sessionId });
  });

  /**
   * viewer-join: called by the viewer client with the host's 6-digit ID.
   * Pairs the viewer with the host session and notifies both parties.
   * Emits viewer-joined to the host and join-ack to the viewer.
   */
  socket.on('viewer-join', ({ sessionId }) => {
    const session = sessions[sessionId];
    if (!session) {
      socket.emit('join-error', { reason: 'Session not found' });
      return;
    }
    if (session.viewerSocketId) {
      socket.emit('join-error', { reason: 'Session already has a viewer' });
      return;
    }

    session.viewerSocketId = socket.id;
    socketToSession[socket.id] = { sessionId, role: 'viewer' };
    console.log(`[viewer-join] session ${sessionId} → viewer ${socket.id}`);

    // Notify the host that a viewer has joined, passing the viewer's socket ID
    io.to(session.hostSocketId).emit('viewer-joined', { viewerSocketId: socket.id });

    // Acknowledge the viewer and pass the host's socket ID for direct signaling
    socket.emit('join-ack', { hostSocketId: session.hostSocketId });
  });

  /**
   * signal: generic relay for WebRTC signaling messages (SDP offer/answer, ICE candidates).
   * Payload: { to: string (target socketId), data: any }
   * Relays data to the target socket as { from: socket.id, data }.
   */
  socket.on('signal', ({ to, data }) => {
    console.log(`[signal] from ${socket.id} → to ${to}`);
    io.to(to).emit('signal', { from: socket.id, data });
  });

  /**
   * stop-hosting: called by the host client when the user clicks "Stop Hosting".
   * Deletes the session and reverse-lookup entries synchronously, before the socket
   * disconnects and reconnects, to prevent a zombie session racing the reconnect.
   */
  socket.on('stop-hosting', () => {
    const entry = socketToSession[socket.id];
    if (!entry) return;
    const { sessionId } = entry;
    const session = sessions[sessionId];
    if (session && session.viewerSocketId) {
      io.to(session.viewerSocketId).emit('peer-disconnected', { reason: 'Host stopped' });
      delete socketToSession[session.viewerSocketId];
    }
    delete sessions[sessionId];
    delete socketToSession[socket.id];
    console.log(`[stop-hosting] session ${sessionId} removed by host`);
  });

  /**
   * disconnect: clean up sessions and notify the peer when a socket disconnects.
   */
  socket.on('disconnect', () => {
    console.log(`[disconnect] socket ${socket.id}`);
    const entry = socketToSession[socket.id];
    if (!entry) return;

    const { sessionId, role } = entry;
    const session = sessions[sessionId];
    delete socketToSession[socket.id];

    if (!session) return;

    if (role === 'host') {
      // Notify the viewer (if any) that the host disconnected
      if (session.viewerSocketId) {
        io.to(session.viewerSocketId).emit('peer-disconnected', { reason: 'Host disconnected' });
        delete socketToSession[session.viewerSocketId];
      }
      delete sessions[sessionId];
    } else if (role === 'viewer') {
      // Notify the host that the viewer disconnected
      if (session.hostSocketId) {
        io.to(session.hostSocketId).emit('peer-disconnected', { reason: 'Viewer disconnected' });
      }
      session.viewerSocketId = null;
      // socketToSession[socket.id] already deleted above — no second delete needed
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Signaling server running on port ${PORT}`);
});
