import { io } from 'socket.io-client';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
};

export class MultiplayerManager {
  constructor(serverUrl, onStatusChange, onMessageReceived) {
    this.serverUrl = serverUrl;
    this.onStatusChange = onStatusChange;
    this.onMessageReceived = onMessageReceived;
    this.socket = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.roomId = null;
    this.role = null; // 'host' or 'client'
    this.playerName = '';
    this.connectionType = 'none'; // 'webrtc' or 'websocket'
    this.isConnecting = false;
    this.gameStateHandler = null;
  }

  on(event, callback) {
    if (event === 'game-state') {
      this.gameStateHandler = callback;
    }
  }

  off(event, callback) {
    if (event === 'game-state') {
      this.gameStateHandler = null;
    }
  }

  connect(playerName) {
    this.playerName = playerName;
    
    // Connect to local Socket.io signaling server
    this.socket = io(this.serverUrl);

    this.socket.on('connect', () => {
      this.onStatusChange('connected', `Connected to server as ${this.socket.id}`);
    });

    this.socket.on('disconnect', () => {
      this.onStatusChange('disconnected', 'Disconnected from signaling server.');
      this.cleanup();
    });

    this.socket.on('joined', ({ role, roomId, players }) => {
      this.role = role;
      this.roomId = roomId;
      this.onStatusChange('joined', `Joined room ${roomId} as ${role}. Waiting for opponent...`, { role, roomId, players });

      if (role === 'client') {
        // If client, we wait for signaling from the host
        this.onStatusChange('pairing', 'Contacting host, establishing connection...');
      }
    });

    this.socket.on('player-joined', (playerInfo) => {
      this.onStatusChange('player-joined', `${playerInfo.name} joined the room!`, playerInfo);
      
      // If host, initiate WebRTC handshake
      if (this.role === 'host') {
        this.initiateWebRTC();
      }
    });

    this.socket.on('signal', async (signal) => {
      try {
        if (!this.peerConnection) {
          this.setupPeerConnection();
        }

        if (signal.sdp) {
          await this.peerConnection.setRemoteDescription(new RTCSessionDescription(signal.sdp));
          
          if (signal.sdp.type === 'offer') {
            const answer = await this.peerConnection.createAnswer();
            await this.peerConnection.setImmediate ? this.peerConnection.setLocalDescription(answer) : await this.peerConnection.setLocalDescription(answer);
            this.socket.emit('signal', { roomId: this.roomId, signal: { sdp: this.peerConnection.localDescription } });
          }
        } else if (signal.candidate) {
          await this.peerConnection.addIceCandidate(new RTCIceCandidate(signal.candidate));
        }
      } catch (e) {
        console.error('Signaling error', e);
      }
    });

    this.socket.on('player-left', ({ playerId, players }) => {
      this.onStatusChange('opponent-left', 'Opponent disconnected from the match.');
      this.cleanupPeer();
    });

    this.socket.on('room-full', ({ message }) => {
      this.onStatusChange('error', message);
    });

    this.socket.on('game-state', (state) => {
      if (this.connectionType === 'websocket') {
        if (this.gameStateHandler) {
          this.gameStateHandler(state);
        }
      }
    });
  }

  joinRoom(roomId) {
    if (!this.socket) return;
    this.roomId = roomId;
    this.socket.emit('join-room', { roomId, playerName: this.playerName });
  }

  createRoom() {
    // Generate a random 5-character string
    const code = Math.random().toString(36).substring(2, 7).toUpperCase();
    this.joinRoom(code);
  }

  setupPeerConnection() {
    this.peerConnection = new RTCPeerConnection(ICE_SERVERS);

    this.peerConnection.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', { roomId: this.roomId, signal: { candidate: event.candidate } });
      }
    };

    this.peerConnection.onconnectionstatechange = () => {
      console.log('WebRTC Connection state:', this.peerConnection.connectionState);
      if (this.peerConnection.connectionState === 'connected') {
        this.connectionType = 'webrtc';
        this.onStatusChange('playing-active', 'Connection established! Low-latency WebRTC synced.');
      } else if (this.peerConnection.connectionState === 'failed' || this.peerConnection.connectionState === 'closed') {
        // Fallback to WebSocket signaling for gameplay if WebRTC blocks
        if (this.connectionType !== 'websocket') {
          this.connectionType = 'websocket';
          this.onStatusChange('playing-active', 'WebRTC failed. Switched to WebSocket fallback.');
        }
      }
    };

    if (this.role === 'client') {
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel();
      };
    }
  }

  async initiateWebRTC() {
    this.setupPeerConnection();

    // Host creates the DataChannel
    this.dataChannel = this.peerConnection.createDataChannel('gameSync', { ordered: false, maxRetransmits: 0 });
    this.setupDataChannel();

    try {
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      this.socket.emit('signal', { roomId: this.roomId, signal: { sdp: this.peerConnection.localDescription } });

      // Start fallback connection timer. If WebRTC doesn't connect in 3.5 seconds, trigger Socket fallback.
      setTimeout(() => {
        if (this.connectionType === 'none') {
          this.connectionType = 'websocket';
          this.onStatusChange('playing-active', 'WebRTC connection timed out. Using Socket sync.');
        }
      }, 3500);
    } catch (e) {
      console.error('Failed to create WebRTC Offer', e);
      this.connectionType = 'websocket';
      this.onStatusChange('playing-active', 'WebRTC initiation failed. Using Socket sync.');
    }
  }

  setupDataChannel() {
    this.dataChannel.onopen = () => {
      console.log('WebRTC Sync Channel Open');
      this.connectionType = 'webrtc';
      this.onStatusChange('playing-active', 'WebRTC data sync channel active.');
    };

    this.dataChannel.onclose = () => {
      console.log('WebRTC Sync Channel Closed');
    };

    this.dataChannel.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);
        this.onMessageReceived(message);
        if (this.gameStateHandler) {
          this.gameStateHandler(message);
        }
      } catch (e) {
        console.error('Failed to parse WebRTC sync packet', e);
      }
    };
  }

  send(data) {
    // Send state payload either through DataChannel (low latency) or Socket.io fallback
    if (this.connectionType === 'webrtc' && this.dataChannel && this.dataChannel.readyState === 'open') {
      try {
        this.dataChannel.send(JSON.stringify(data));
      } catch (e) {
        // Fallback to WebSocket if write fails
        this.sendWebSocket(data);
      }
    } else {
      this.sendWebSocket(data);
    }
  }

  sendWebSocket(data) {
    if (this.socket && this.roomId) {
      this.socket.emit('game-state', { roomId: this.roomId, state: data });
    }
  }

  cleanupPeer() {
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
    this.connectionType = 'none';
  }

  cleanup() {
    this.cleanupPeer();
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.roomId = null;
    this.role = null;
  }
}
