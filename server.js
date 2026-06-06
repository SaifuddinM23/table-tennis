import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { createProxyMiddleware } from 'http-proxy-middleware';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Try to serve from dist if it exists and has index.html, otherwise proxy to vite dev server
const distIndex = path.join(__dirname, 'dist', 'index.html');
const distExists = fs.existsSync(distIndex);

if (distExists) {
  console.log('Serving from dist/ folder');
  app.use(express.static(path.join(__dirname, 'dist')));
  app.get(/(.*)/, (req, res) => {
    res.sendFile(distIndex);
  });
} else {
  console.log('No dist/ build found — proxying to Vite dev server at http://localhost:5173');
  // Proxy all non-socket requests to vite dev server
  const viteProxy = createProxyMiddleware({
    target: 'http://localhost:5173',
    changeOrigin: true,
    ws: true, // proxy websockets for HMR
  });
  app.use(viteProxy);
}

// Keep track of active rooms and their players
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`User connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, playerName }) => {
    socket.join(roomId);
    
    if (!rooms.has(roomId)) {
      rooms.set(roomId, []);
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
    
    // Notify other player in the room
    socket.to(roomId).emit('player-joined', playerInfo);
    
    console.log(`User ${socket.id} (${playerName}) joined room ${roomId} as ${role}`);
    
    if (players.length === 2) {
      io.to(roomId).emit('start-matchmaking');
    }
  });

  socket.on('signal', ({ roomId, signal }) => {
    // Relay signaling data (SDP, ICE candidates) to other peer in room
    socket.to(roomId).emit('signal', signal);
  });

  socket.on('game-state', ({ roomId, state }) => {
    // Fast relay for fallback socket synchronization if WebRTC fails
    socket.to(roomId).emit('game-state', state);
  });

  socket.on('leave-room', (roomId) => {
    handleLeaveRoom(socket, roomId);
  });

  socket.on('disconnecting', () => {
    for (const roomId of socket.rooms) {
      if (roomId !== socket.id) {
        handleLeaveRoom(socket, roomId);
      }
    }
  });

  socket.on('disconnect', () => {
    console.log(`User disconnected: ${socket.id}`);
  });
});

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
      socket.to(roomId).emit('player-left', { playerId: socket.id, players });
      console.log(`Player left ${roomId}. Remaining:`, players);
    }
  }
  socket.leave(roomId);
}

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Ping pong server running on port ${PORT}`);
});
