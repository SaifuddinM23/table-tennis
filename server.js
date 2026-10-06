import express from 'express';
import { createServer } from 'http';
import https from 'https';
import { Server } from 'socket.io';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
console.log('[DEBUG] server.js initialized. Starting server setup...');
const HTTP_PORT = process.env.PORT || 3005;
const HTTPS_PORT = 3006;

// Helper to resolve local network IP
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Endpoint to provide desktop connection details to phone client
// Dynamically adjusts protocol and port based on desktop secure context
app.get('/api/connection-info', (req, res) => {
  const isEncrypted = !!req.socket.encrypted;
  res.json({
    localIp: getLocalIp(),
    port: isEncrypted ? HTTPS_PORT : HTTP_PORT,
    protocol: isEncrypted ? 'https:' : 'http:'
  });
});

// Try to serve from dist if it exists and has index.html, otherwise proxy to vite dev server
const distIndex = path.join(__dirname, 'dist', 'index.html');
const distExists = fs.existsSync(distIndex) && process.env.NODE_ENV !== 'development';

if (distExists) {
  console.log('Serving from dist/ folder');
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/(.*)/, (req, res) => {
    res.sendFile(distIndex);
  });
} else {
  console.log('No dist/ build found — proxying to Vite dev server at http://127.0.0.1:5175');
  // Proxy all non-socket requests to vite dev server
  const viteProxy = createProxyMiddleware({
    target: 'http://127.0.0.1:5175',
    changeOrigin: true,
    ws: true, // proxy websockets for HMR
  });
  app.use(viteProxy);
}

// Keep track of active rooms and their players
const rooms = new Map();

// Check for SSL credentials
const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');
let sslOptions = null;

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    sslOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath)
    };
  } catch (err) {
    console.error('[Server] SSL certificate loading failed:', err);
  }
}

// Create HTTP Server (Port 3001)
const httpServer = createServer(app);
const ioHttp = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Create HTTPS Server (Port 3002)
let httpsServer = null;
let ioHttps = null;

if (sslOptions) {
  httpsServer = https.createServer(sslOptions, app);
  ioHttps = new Server(httpsServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });
}

// Shared Socket.io Connection Logic
function handleSocketEvents(socket) {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, playerName, isController }) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
    }
    
    if (isController) {
      console.log(`Phone Controller connected to room ${roomId}`);
      // Notify other sockets in the room on both HTTP and HTTPS servers
      ioHttp.to(roomId).emit('controller-connected', { id: socket.id });
      if (ioHttps) {
        ioHttps.to(roomId).emit('controller-connected', { id: socket.id });
      }
      return;
    }
    
    const players = rooms.get(roomId);
    
    // Check if room is full
    if (players.length >= 2) {
      socket.emit('room-full', { message: 'Room is already full.' });
      return;
    }
    
    // Determine player role
    const role = players.length === 0 ? 'host' : 'client';
    const playerInfo = { id: socket.id, name: playerName, role };
    players.push(playerInfo);
    
    socket.emit('joined', { role, roomId, players });
    
    // Notify other player in the room on both HTTP and HTTPS servers
    ioHttp.to(roomId).emit('player-joined', playerInfo);
    if (ioHttps) {
      ioHttps.to(roomId).emit('player-joined', playerInfo);
    }
    
    console.log(`User ${socket.id} (${playerName}) joined room ${roomId} as ${role}`);
    
    if (players.length === 2) {
      ioHttp.to(roomId).emit('start-matchmaking'); // Broadcast to all clients on both servers
      if (ioHttps) {
        ioHttps.to(roomId).emit('start-matchmaking');
      }
    }
  });

  socket.on('controller-input', ({ roomId, data }) => {
    // Relay orientation and movement details to desktop client on both HTTP and HTTPS servers
    ioHttp.to(roomId).emit('controller-input', data);
    if (ioHttps) {
      ioHttps.to(roomId).emit('controller-input', data);
    }
  });

  socket.on('signal', ({ roomId, signal }) => {
    // Relay signaling data (SDP, ICE candidates) to other peer in room on both servers
    ioHttp.to(roomId).emit('signal', signal);
    if (ioHttps) {
      ioHttps.to(roomId).emit('signal', signal);
    }
  });

  socket.on('game-state', ({ roomId, state }) => {
    // Fast relay for fallback socket synchronization on both servers
    ioHttp.to(roomId).emit('game-state', state);
    if (ioHttps) {
      ioHttps.to(roomId).emit('game-state', state);
    }
  });

  socket.on('paddle-hit-feedback', ({ roomId, hitter, speed }) => {
    // Relay hit events and speeds to mobile controller for haptics/audio
    ioHttp.to(roomId).emit('paddle-hit-feedback', { hitter, speed });
    if (ioHttps) {
      ioHttps.to(roomId).emit('paddle-hit-feedback', { hitter, speed });
    }
  });

  socket.on('game-state-sync', ({ roomId, score, lastSwingSpeed }) => {
    // Relay game scores and statistics to mobile controller dashboard
    ioHttp.to(roomId).emit('game-state-sync', { score, lastSwingSpeed });
    if (ioHttps) {
      ioHttps.to(roomId).emit('game-state-sync', { score, lastSwingSpeed });
    }
  });

  socket.on('leave-room', (roomId) => {
    ioHttp.to(roomId).emit('controller-disconnected', { id: socket.id });
    if (ioHttps) {
      ioHttps.to(roomId).emit('controller-disconnected', { id: socket.id });
    }
    handleLeaveRoom(socket, roomId);
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        ioHttp.to(roomId).emit('controller-disconnected', { id: socket.id });
        if (ioHttps) {
          ioHttps.to(roomId).emit('controller-disconnected', { id: socket.id });
        }
        handleLeaveRoom(socket, roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
}

function handleLeaveRoom(socket, roomId) {
  if (rooms.has(roomId)) {
    let players = rooms.get(roomId);
    players = players.filter(p => p.id !== socket.id);
    
    if (players.length === 0) {
      rooms.delete(roomId);
      console.log(`Room ${roomId} deleted (empty)`);
    } else {
      rooms.set(roomId, players);
      // Promote client to host if host left
      if (players[0] && players[0].role !== 'host') {
        players[0].role = 'host';
      }
      ioHttp.to(roomId).emit('player-left', { playerId: socket.id, players });
      if (ioHttps) {
        ioHttps.to(roomId).emit('player-left', { playerId: socket.id, players });
      }
      console.log(`Player left ${roomId}. Remaining:`, players);
    }
  }
  socket.leave(roomId);
}

// Bind connection handler to both Socket.io instances
ioHttp.on('connection', handleSocketEvents);
if (ioHttps) {
  ioHttps.on('connection', handleSocketEvents);
}

// Start HTTP Server
httpServer.listen(HTTP_PORT, () => {
  const localIP = getLocalIp();
  console.log('==================================================================');
  console.log(`🌐 HTTP SERVER RUNNING ON PORT ${HTTP_PORT} (Recommended for Android Chrome Flags)`);
  console.log(`🖥️  Receiver (Desktop): http://localhost:${HTTP_PORT}/`);
  console.log(`📱 Controller (Mobile): http://${localIP}:${HTTP_PORT}/`);
  console.log('==================================================================');
});

// Start HTTPS Server
if (httpsServer) {
  httpsServer.listen(HTTPS_PORT, () => {
    const localIP = getLocalIp();
    console.log('==================================================================');
    console.log(`🔒 HTTPS SERVER RUNNING ON PORT ${HTTPS_PORT} (Required for iOS Safari Sensors)`);
    console.log(`🖥️  Receiver (Desktop): https://localhost:${HTTPS_PORT}/`);
    console.log(`📱 Controller (Mobile): https://${localIP}:${HTTPS_PORT}/`);
    console.log('==================================================================');
  });
} else {
  console.log('==================================================================');
  console.log(`⚠️  SSL Keys not found. HTTPS Server on Port ${HTTPS_PORT} is offline.`);
  console.log('==================================================================');
}
