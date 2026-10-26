import React, { useState, useEffect, useRef } from 'react';
import { Play, Users, Trophy, BrainCircuit, RotateCcw, Video, Eye, ArrowLeft, Send, Copy, Check } from 'lucide-react';
import { PingPongPhysics } from './physics/PingPongPhysics';
import GameCanvas from './components/GameCanvas';
import VoiceControls from './components/VoiceControls';
import HeatmapOverlay from './components/HeatmapOverlay';
import AICoach from './components/AICoach';
import Leaderboard from './components/Leaderboard';
import { MultiplayerManager } from './components/MultiplayerManager';

const LOCAL_SERVER_URL = 
  import.meta.env.VITE_SERVER_URL ||
  (window.location.hostname === 'localhost' || 
  window.location.hostname.startsWith('192.168.') || 
  window.location.hostname.startsWith('10.') || 
  window.location.hostname.startsWith('172.')
    ? `${window.location.protocol}//${window.location.hostname}:${window.location.port || '3005'}`
    : window.location.origin);

export default function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('pingpong_player_name') || 'Player 1');
  
  // Gyroscope Racket Controller states
  const [controllerRoomId, setControllerRoomId] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('controller') || '';
  });
  const isControllerMode = !!controllerRoomId;

  // Desktop side states
  const [phoneRacketActive, setPhoneRacketActive] = useState(false);
  const [phoneRacketConnected, setPhoneRacketConnected] = useState(false);
  const [phonePairingCode, setPhonePairingCode] = useState('');
  const [desktopSocket, setDesktopSocket] = useState(null);
  const [phoneControllerData, setPhoneControllerData] = useState(null);
  const [localIpAddress, setLocalIpAddress] = useState('localhost');

  // Mobile side states
  const [mobileSocket, setMobileSocket] = useState(null);
  const [isMobileConnected, setIsMobileConnected] = useState(false);
  const [motionPermission, setMotionPermission] = useState('unknown'); // unknown, granted, denied
  const [calibratedAngles, setCalibratedAngles] = useState({ alpha: 0, beta: 0, gamma: 0 });
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [gyroDebug, setGyroDebug] = useState({ alpha: 0, beta: 0, gamma: 0, accel: 0 });
  const [gyroActive, setGyroActive] = useState(false);
  const dragStartRef = useRef(null);

  const sensorDataRef = useRef({
    alpha: 0, beta: 0, gamma: 0,
    accelX: 0, accelY: 0, accelZ: 0,
    accelMag: 0,
    calibratedAlpha: 0,
    calibratedBeta: 0,
    calibratedGamma: 0,
    isCalibrated: false
  });

  const [screen, setScreen] = useState(isControllerMode ? 'controller-mobile' : 'menu'); // menu, lobby, playing, postmatch, controller-mobile
  const [mode, setMode] = useState('singleplayer'); // singleplayer, multiplayer
  const [activeTab, setActiveTab] = useState('game'); // game, stats, leader, coach
  const [isARMode, setIsARMode] = useState(false);
  
  // Game state sync
  const [score, setScore] = useState({ player: 0, opponent: 0 });
  const [currentGameState, setCurrentGameState] = useState('menu');
  const [activeReplayFrame, setActiveReplayFrame] = useState(null);
  const [selectedRallyForReplay, setSelectedRallyForReplay] = useState(null);
  const [isReplaying, setIsReplaying] = useState(false);

  // Stats
  const [maxSpeed, setMaxSpeed] = useState(0);
  const [maxRallyLength, setMaxRallyLength] = useState(0);
  const [rallyLog, setRallyLog] = useState([]);
  
  // Multiplayer
  const [roomIdInput, setRoomIdInput] = useState('');
  const [activeRoomId, setActiveRoomId] = useState('');
  const [multiplayerStatus, setMultiplayerStatus] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [playersList, setPlayersList] = useState([]);
  const [role, setRole] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [isHandTracking, setIsHandTracking] = useState(false);
  const [difficulty, setDifficulty] = useState('medium');
  const [handSpeed, setHandSpeed] = useState(0);

  // Mobile Controller HUD State
  const [mobileScore, setMobileScore] = useState({ player: 0, opponent: 0 });
  const [mobileLastSpeed, setMobileLastSpeed] = useState(0);
  const [mobileSpinType, setMobileSpinType] = useState('flat');

  // Synthetic Ping-Pong wood/rubber racket strike click
  const playSyntheticHitSound = () => {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      
      // Realistic plastic ball hitting a racket (deeper click with body resonance decay)
      osc.type = 'sine';
      osc.frequency.setValueAtTime(1400, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.004); // fast transient slap
      osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.045); // body decay
      
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
      
      osc.start();
      osc.stop(ctx.currentTime + 0.045);
    } catch (err) {
      console.warn('[Audio] Local hit sound generation failed:', err);
    }
  };

  const physicsRef = useRef(new PingPongPhysics());
  const mpManagerRef = useRef(null);
  const [webcamElement, setWebcamElement] = useState(null);

  // Sync difficulty to physics engine
  useEffect(() => {
    if (physicsRef.current) {
      physicsRef.current.difficulty = difficulty;
    }
  }, [difficulty, screen]);

  // Sync player name to localStorage
  useEffect(() => {
    localStorage.setItem('pingpong_player_name', playerName);
  }, [playerName]);

  // Desktop side Socket.io handler for Phone Controller pairing
  useEffect(() => {
    if (isControllerMode || !phoneRacketActive) {
      if (desktopSocket) {
        desktopSocket.disconnect();
        setDesktopSocket(null);
      }
      setPhoneRacketConnected(false);
      return;
    }

    import('socket.io-client').then(({ io }) => {
      // Generate a random 5-character pairing code if not already set
      const code = phonePairingCode || Math.random().toString(36).substring(2, 7).toUpperCase();
      if (!phonePairingCode) {
        setPhonePairingCode(code);
      }

      // Fetch local IP address from backend first so QR code points to correct URL
      fetch(`${LOCAL_SERVER_URL}/api/connection-info`)
        .then(res => res.json())
        .then(data => {
          if (data.localIp) {
            setLocalIpAddress(data.localIp);
          }
        })
        .catch(err => console.error("Failed to fetch connection info", err));

      const socket = io(LOCAL_SERVER_URL);
      setDesktopSocket(socket);

      socket.on('connect', () => {
        socket.emit('join-room', { roomId: code, playerName: 'Desktop Screen' });
      });

      socket.on('controller-connected', () => {
        setPhoneRacketConnected(true);
        console.log('Phone racket connected successfully!');
      });

      socket.on('controller-disconnected', () => {
        setPhoneRacketConnected(false);
        console.log('Phone racket disconnected.');
      });

      socket.on('controller-input', (data) => {
        setPhoneControllerData(data);
      });
    });

    return () => {
      if (desktopSocket) {
        desktopSocket.disconnect();
      }
    };
  }, [phoneRacketActive, isControllerMode]);

  // Mobile side Socket.io handler
  useEffect(() => {
    if (!isControllerMode) return;

    import('socket.io-client').then(({ io }) => {
      const socket = io(LOCAL_SERVER_URL);
      setMobileSocket(socket);

      socket.on('connect', () => {
        socket.emit('join-room', { roomId: controllerRoomId, playerName: 'Phone Racket', isController: true });
        setIsMobileConnected(true);
      });

      socket.on('disconnect', () => {
        setIsMobileConnected(false);
      });

      socket.on('paddle-hit-feedback', ({ hitter, speed }) => {
        if (hitter === 'player') {
          playSyntheticHitSound();
          if (navigator.vibrate) {
            navigator.vibrate(Math.min(70, 25 + speed * 2.0));
          }
        }
      });

      socket.on('game-state-sync', ({ score: syncedScore, lastSwingSpeed }) => {
        if (syncedScore) {
          setMobileScore(syncedScore);
        }
        if (lastSwingSpeed) {
          setMobileLastSpeed(lastSwingSpeed);
        }
      });
    });

    return () => {
      if (mobileSocket) {
        mobileSocket.disconnect();
      }
    };
  }, [isControllerMode, controllerRoomId]);

  // Transmit gyroscope sensors data to server at 60fps
  useEffect(() => {
    if (!isControllerMode || !mobileSocket || !isMobileConnected) return;

    const sendInterval = setInterval(() => {
      const s = sensorDataRef.current;
      if (!s.isCalibrated) return;

      // Calculate deltas
      let deltaAlpha = s.alpha - s.calibratedAlpha;
      let deltaBeta = s.beta - s.calibratedBeta;
      let deltaGamma = s.gamma - s.calibratedGamma;

      // Keep angles within [-180, 180] range
      if (deltaAlpha > 180) deltaAlpha -= 360;
      if (deltaAlpha < -180) deltaAlpha += 360;
      if (deltaBeta > 180) deltaBeta -= 360;
      if (deltaBeta < -180) deltaBeta += 360;
      if (deltaGamma > 180) deltaGamma -= 360;
      if (deltaGamma < -180) deltaGamma += 360;

      // Check if phone is held in landscape (horizontal) mode
      const isLandscape = window.innerWidth > window.innerHeight;

      // Detect screen orientation angle to handle landscape-left vs landscape-right
      let orientationAngle = 0;
      if (window.screen && window.screen.orientation) {
        orientationAngle = window.screen.orientation.angle;
      } else if (typeof window.orientation !== 'undefined') {
        orientationAngle = window.orientation;
      }

      // In landscape (horizontal) mode, the phone's physical axes swap:
      // - Tilting left/right corresponds to deltaBeta (pitch)
      // - Tilting forward/backward corresponds to deltaGamma (roll)
      // We invert signs based on orientationAngle (90 vs 270 / -90) to ensure intuitive direction:
      let tiltX = deltaBeta;
      let tiltZ = deltaGamma;

      if (isLandscape) {
        const isReversedLandscape = (orientationAngle === 270 || orientationAngle === -90);
        tiltX = isReversedLandscape ? -deltaGamma : deltaGamma;
        tiltZ = isReversedLandscape ? deltaBeta : -deltaBeta;
      }

      // Sync local spin type state for the dashboard UI
      setMobileSpinType(s.spinType || 'flat');

      // Emit controller input packet
      mobileSocket.emit('controller-input', {
        roomId: controllerRoomId,
        data: {
          tiltX: tiltX,        // Pitch delta (forward/backward)
          tiltY: deltaAlpha,   // Yaw delta
          tiltZ: tiltZ,        // Roll delta (left/right)
          accelX: s.accelX,
          accelY: s.accelY,
          accelZ: s.accelZ,
          accelMag: s.accelMag,
          spinType: s.spinType || 'flat'
        }
      });
    }, 16); // ~60fps

    return () => clearInterval(sendInterval);
  }, [mobileSocket, isMobileConnected]);

  // Stable refs to avoid stale closures in polling interval
  const modeRef = useRef(mode);
  const playerListRef = useRef(playersList);
  useEffect(() => { modeRef.current = mode; }, [mode]);
  useEffect(() => { playerListRef.current = playersList; }, [playersList]);

  // Main UI update listener — only updates state when values actually change
  // to prevent constant re-renders that would cancel the serve timeouts
  useEffect(() => {
    const prevScore = { player: 0, opponent: 0 };
    let prevGameState = '';
    let prevMaxSpeed = 0;
    let prevMaxRallyLength = 0;
    let prevRallyLogLen = 0;

    const interval = setInterval(() => {
      if (screen === 'playing') {
        const physics = physicsRef.current;

        // Only update score state if score actually changed
        if (physics.score.player !== prevScore.player || physics.score.opponent !== prevScore.opponent) {
          prevScore.player = physics.score.player;
          prevScore.opponent = physics.score.opponent;
          const newScore = { player: physics.score.player, opponent: physics.score.opponent };
          setScore(newScore);
          
          if (desktopSocket) {
            desktopSocket.emit('game-state-sync', {
              roomId: code,
              score: newScore,
              lastSwingSpeed: 0
            });
          }
        }

        // Only update gameState if it actually changed
        if (physics.gameState !== prevGameState) {
          prevGameState = physics.gameState;
          setCurrentGameState(physics.gameState);
        }

        if (physics.maxSpeed !== prevMaxSpeed) {
          prevMaxSpeed = physics.maxSpeed;
          setMaxSpeed(physics.maxSpeed);
        }

        if (physics.maxRallyLength !== prevMaxRallyLength) {
          prevMaxRallyLength = physics.maxRallyLength;
          setMaxRallyLength(physics.maxRallyLength);
        }

        // Only update rallyLog if new entries were added
        if (physics.rallyLog.length !== prevRallyLogLen) {
          prevRallyLogLen = physics.rallyLog.length;
          setRallyLog([...physics.rallyLog]);
        }

        if (physics.gameState === 'game_over') {
          const currentMode = modeRef.current;
          const currentPlayersList = playerListRef.current;
          // Trigger match ELO calculations for leaderboard
          setMatchResult({
            playerWon: physics.winner === 'player',
            opponentName: currentMode === 'singleplayer' ? 'AI Coach (Pro)' : (currentPlayersList.find(p => p.id !== mpManagerRef.current?.socket?.id)?.name || 'Online Challenger'),
            opponentElo: currentMode === 'singleplayer' ? 1650 : 1300,
            processed: false
          });
          setScreen('postmatch');
          setActiveTab('coach'); // land directly on AI Coach feedback page
        }
      }
    }, 100);

    return () => clearInterval(interval);
  }, [screen]);

  // Keyboard shortcut: Spacebar to serve the ball
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.code === 'Space') {
        if (currentGameState === 'serve_player') {
          handleServe();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentGameState]);

  // NOTE: Auto-serving in singleplayer mode is now handled directly inside
  // PingPongPhysics.js via a setTimeout in awardPoint(). This avoids React
  // effect cleanup races that were causing the serve timer to be cancelled,
  // stopping the game after a single point.

  const handleStartMobileController = async () => {
    // Request device orientation permission for iOS
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const permissionState = await DeviceOrientationEvent.requestPermission();
        setMotionPermission(permissionState);
        if (permissionState !== 'granted') {
          alert('Sensor permission denied. The racket gyro will not respond.');
          return;
        }
      } catch (e) {
        console.error(e);
        alert('Permission request failed: ' + e.message);
        return;
      }
    } else {
      setMotionPermission('granted');
    }

    // Request device motion permission (for swings)
    if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
      try {
        await DeviceMotionEvent.requestPermission();
      } catch (e) {
        console.error(e);
      }
    }

    // Set up event listeners
    const handleOrientation = (event) => {
      const { alpha, beta, gamma } = event;
      if (alpha === null || beta === null || gamma === null) return;

      const s = sensorDataRef.current;
      
      if (!s.gyroActive) {
        s.gyroActive = true;
        setGyroActive(true);
      }

      if (!s.isCalibrated) {
        s.calibratedAlpha = alpha;
        s.calibratedBeta = beta;
        s.calibratedGamma = gamma;
        s.isCalibrated = true;
        setIsCalibrated(true);
        s.alpha = alpha;
        s.beta = beta;
        s.gamma = gamma;
        return;
      }

      // Low-pass filter (0.45 coefficient) to smooth out raw sensor noise
      s.alpha = s.alpha + (alpha - s.alpha) * 0.45;
      s.beta = s.beta + (beta - s.beta) * 0.45;
      s.gamma = s.gamma + (gamma - s.gamma) * 0.45;

      // Update state for debugging/visualizer at a lower frequency to optimize rendering
      setGyroDebug(prev => ({
        ...prev,
        alpha: Math.round(s.alpha),
        beta: Math.round(s.beta),
        gamma: Math.round(s.gamma)
      }));
    };

    const handleMotion = (event) => {
      const acc = event.acceleration || event.accelerationIncludingGravity;
      if (!acc) return;

      const s = sensorDataRef.current;
      s.accelX = acc.x || 0;
      s.accelY = acc.y || 0;
      s.accelZ = acc.z || 0;
      
      const magnitude = Math.sqrt(s.accelX*s.accelX + s.accelY*s.accelY + s.accelZ*s.accelZ);
      s.accelMag = magnitude;

      // Classification of spin type based on raw vertical acceleration peak during active swings
      let spinType = 'flat';
      if (magnitude > 6.0) {
        if (s.accelY > 2.0) {
          spinType = 'topspin';
        } else if (s.accelY < -2.0) {
          spinType = 'backspin';
        }
      }
      s.spinType = spinType;

      setGyroDebug(prev => ({
        ...prev,
        accel: magnitude
      }));
    };

    window.addEventListener('deviceorientation', handleOrientation);
    window.addEventListener('devicemotion', handleMotion);

    // Save event listeners in ref/window to clean up on unmount
    window._activeOrientationHandler = handleOrientation;
    window._activeMotionHandler = handleMotion;

    // Start a 1.5 second fallback monitor
    setTimeout(() => {
      const s = sensorDataRef.current;
      if (!s.gyroActive) {
        console.warn('[Sensor] Telemetry timeout: enabling touchpad emulation.');
        s.calibratedAlpha = 0;
        s.calibratedBeta = 0;
        s.calibratedGamma = 0;
        s.alpha = 0;
        s.beta = 0;
        s.gamma = 0;
        s.isCalibrated = true;
        setIsCalibrated(true);
      }
    }, 1500);
  };

  const handleTouchStart = (e) => {
    if (!isCalibrated || gyroActive) return;
    const touch = e.touches[0];
    dragStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      beta: sensorDataRef.current.beta,
      gamma: sensorDataRef.current.gamma
    };
  };

  const handleTouchMove = (e) => {
    if (!isCalibrated || gyroActive || !dragStartRef.current) return;
    const touch = e.touches[0];
    const dx = touch.clientX - dragStartRef.current.x;
    const dy = touch.clientY - dragStartRef.current.y;

    const newGamma = Math.max(-30, Math.min(30, dragStartRef.current.gamma + dx * 0.3));
    const newBeta = Math.max(-15, Math.min(15, dragStartRef.current.beta - dy * 0.3));

    const s = sensorDataRef.current;
    s.gamma = newGamma;
    s.beta = newBeta;
    s.alpha = 0;

    setGyroDebug(prev => ({
      ...prev,
      gamma: Math.round(newGamma),
      beta: Math.round(newBeta)
    }));
  };

  const handleMobileServe = () => {
    if (mobileSocket && isMobileConnected) {
      mobileSocket.emit('controller-input', {
        roomId: controllerRoomId,
        data: {
          tapServed: true
        }
      });
    }
  };

  const handleRecalibrate = () => {
    const s = sensorDataRef.current;
    s.calibratedAlpha = s.alpha;
    s.calibratedBeta = s.beta;
    s.calibratedGamma = s.gamma;
    s.isCalibrated = true;
    setCalibratedAngles({
      alpha: s.alpha,
      beta: s.beta,
      gamma: s.gamma
    });
  };

  // Clean up mobile sensor listeners if unmounting
  useEffect(() => {
    return () => {
      if (window._activeOrientationHandler) {
        window.removeEventListener('deviceorientation', window._activeOrientationHandler);
      }
      if (window._activeMotionHandler) {
        window.removeEventListener('devicemotion', window._activeMotionHandler);
      }
    };
  }, []);

  const handleStartSingleplayer = () => {
    physicsRef.current = new PingPongPhysics();
    physicsRef.current.difficulty = difficulty;
    physicsRef.current.mode = 'singleplayer'; // tells physics engine to auto-serve
    // Auto-serve the first ball after a short delay
    setTimeout(() => {
      if (physicsRef.current.gameState === 'serve_player') {
        physicsRef.current.serveBall('player');
      }
    }, 1500);
    physicsRef.current.gameState = 'serve_player';
    setMode('singleplayer');
    setScreen('playing');
    setActiveTab('game');
    setIsARMode(false);
  };

  const handleStartMultiplayerLobby = () => {
    setMode('multiplayer');
    setScreen('lobby');
    setMultiplayerStatus('Initializing connectivity...');
    
    // Instantiate WebRTC multiplayer manager
    mpManagerRef.current = new MultiplayerManager(
      LOCAL_SERVER_URL,
      handleMultiplayerStatusChange,
      handleMultiplayerMessageReceived
    );
    mpManagerRef.current.connect(playerName);
  };

  const handleMultiplayerStatusChange = (type, message, details) => {
    setMultiplayerStatus(message);
    
    if (type === 'joined') {
      setActiveRoomId(details.roomId);
      setRole(details.role);
      setPlayersList(details.players);
    } else if (type === 'player-joined') {
      setPlayersList(prev => [...prev, details]);
    } else if (type === 'playing-active') {
      // Transition to game screen
      physicsRef.current = new PingPongPhysics();
      physicsRef.current.mode = 'multiplayer';
      // Host serves first
      physicsRef.current.gameState = mpManagerRef.current.role === 'host' ? 'serve_player' : 'serve_opponent';
      physicsRef.current.servingPlayer = 'player'; // local host perspective
      setScreen('playing');
      setActiveTab('game');
    } else if (type === 'opponent-left') {
      alert('Opponent disconnected from room. Ending match.');
      handleBackToMenu();
    } else if (type === 'error') {
      alert(message);
      setScreen('menu');
    }
  };

  const handleMultiplayerMessageReceived = (message) => {
    // In multiplayer role context:
    // Sync incoming game state
    // Managed inside GameCanvas
  };

  const handleCreateRoom = () => {
    if (mpManagerRef.current) {
      mpManagerRef.current.createRoom();
    }
  };

  const handleJoinRoom = (e) => {
    e.preventDefault();
    if (mpManagerRef.current && roomIdInput) {
      mpManagerRef.current.joinRoom(roomIdInput.trim().toUpperCase());
    }
  };

  const handleServe = () => {
    physicsRef.current.serveBall('player');
  };

  const handleResetMatch = () => {
    if (window.confirm("Are you sure you want to reset scores?")) {
      physicsRef.current.score = { player: 0, opponent: 0 };
      physicsRef.current.resetBall();
      physicsRef.current.gameState = 'serve_player';
    }
  };

  const handleVoiceCommand = (cmd) => {
    console.log(`Voice Command Received in App: "${cmd}"`);
    if (cmd === 'start') {
      if (screen === 'menu') handleStartSingleplayer();
    } else if (cmd === 'serve' || cmd === 'resume') {
      if (currentGameState === 'serve_player') handleServe();
    } else if (cmd === 'reset') {
      handleResetMatch();
    } else if (cmd === 'replay') {
      if (rallyLog.length > 0) {
        handleTriggerReplay(rallyLog[rallyLog.length - 1]);
      }
    } else if (cmd === 'pause') {
      // Toggle serve/playing
      if (physicsRef.current.gameState === 'playing') {
        physicsRef.current.gameState = 'serve_player';
      }
    }
  };

  const handleTriggerReplay = (rally) => {
    setSelectedRallyForReplay(rally);
    setIsReplaying(true);
  };

  const handleCloseReplay = () => {
    setIsReplaying(false);
    setSelectedRallyForReplay(null);
    setActiveReplayFrame(null);
  };

  const handleBackToMenu = () => {
    if (mpManagerRef.current) {
      mpManagerRef.current.cleanup();
      mpManagerRef.current = null;
    }
    physicsRef.current = new PingPongPhysics();
    setScreen('menu');
    setIsARMode(false);
    handleCloseReplay();
  };

  const speedKmh = Math.round(maxSpeed * 3.6);

  return (
    <div className="app-container">
      
      {/* 1. MAIN MENU SCREEN */}
      {screen === 'menu' && (
        <div className="main-menu">
          <h1 className="menu-title float-animation">Hyperspace Pong</h1>
          <p className="menu-subtitle">Premium 3D Physics • WebRTC Multiplayer • AR Engine</p>

          <div className="menu-card glassmorphism">
            <div className="input-group">
              <label>Player Username</label>
              <input
                type="text"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                placeholder="Enter username"
                maxLength={14}
              />
            </div>

            <div className="input-group">
              <label>AI Difficulty</label>
              <select
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value)}
                style={{
                  background: 'rgba(0, 0, 0, 0.04)',
                  border: '1px solid rgba(0, 0, 0, 0.08)',
                  borderRadius: '8px',
                  color: 'var(--text-primary)',
                  padding: '8px 12px',
                  fontSize: '0.9rem',
                  outline: 'none',
                  fontWeight: '600',
                  fontFamily: 'Inter, sans-serif'
                }}
              >
                <option value="easy">Easy Bot</option>
                <option value="medium">Medium Bot</option>
                <option value="pro">Pro Bot (Enhanced AI)</option>
              </select>
            </div>

            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={isHandTracking}
                  onChange={(e) => {
                    setIsHandTracking(e.target.checked);
                    if (e.target.checked) setPhoneRacketActive(false); // mutually exclusive
                  }}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span>Enable Camera Hand Controller</span>
              </label>
            </div>

            <div className="input-group">
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={phoneRacketActive}
                  onChange={(e) => {
                    setPhoneRacketActive(e.target.checked);
                    if (e.target.checked) setIsHandTracking(false); // mutually exclusive
                  }}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span>Enable Phone Gyro Racket</span>
              </label>
            </div>

            {phoneRacketActive && (
              <div className="phone-pairing-box glassmorphism" style={{ padding: '12px', marginTop: '4px', marginBottom: '8px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', background: 'rgba(255, 255, 255, 0.08)', borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', fontWeight: 'bold' }}>
                  <span className={`status-dot ${phoneRacketConnected ? 'active' : 'waiting'}`} style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: phoneRacketConnected ? '#2a9d8f' : '#ffd166', boxShadow: phoneRacketConnected ? '0 0 8px #2a9d8f' : '0 0 8px #ffd166' }}></span>
                  <span style={{ color: 'var(--text-primary)' }}>
                    {phoneRacketConnected ? 'Phone Racket Connected!' : 'Waiting for Phone Racket...'}
                  </span>
                </div>
                
                {!phoneRacketConnected && phonePairingCode && (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', width: '100%' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                      Scan QR Code or visit this URL on your phone:
                    </div>
                    <img 
                      src={`https://api.qrserver.com/v1/create-qr-code/?size=110x110&data=${encodeURIComponent(`${window.location.protocol}//${localIpAddress}:${window.location.port || '3001'}/?controller=${phonePairingCode}`)}`}
                      alt="Pairing QR Code"
                      style={{ border: '4px solid white', borderRadius: '8px', width: '110px', height: '110px' }}
                    />
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', wordBreak: 'break-all', fontFamily: 'monospace', background: 'rgba(0,0,0,0.04)', padding: '4px 8px', borderRadius: '4px', textAlign: 'center', width: '100%' }}>
                      {`${window.location.protocol}//${localIpAddress}:${window.location.port || '3001'}/?controller=${phonePairingCode}`}
                    </div>
                  </div>
                )}
              </div>
            )}

            <button onClick={handleStartSingleplayer} className="btn-neon-cyan">
              <Play size={18} fill="currentColor" />
              Single Player VS AI
            </button>

            <button onClick={handleStartMultiplayerLobby} className="btn-neon-magenta">
              <Users size={18} />
              Multiplayer (WebRTC)
            </button>
            
            <div style={{ marginTop: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#8892b0', fontFamily: 'Orbitron, sans-serif' }}>
                <Trophy size={14} color="#ffd700" />
                <span>LEADERBOARD PREVIEW</span>
              </div>
              <Leaderboard matchResult={null} />
            </div>
          </div>
        </div>
      )}

      {/* 2. MULTIPLAYER LOBBY SCREEN */}
      {screen === 'lobby' && (
        <div className="main-menu">
          <div className="multiplayer-lobby glassmorphism">
            <div className="lobby-header">
              <h2 className="lobby-title">Multiplayer Matchmaker</h2>
              <p className="lobby-subtitle">Low-Latency WebRTC Sync</p>
            </div>

            <div style={{ background: 'rgba(0, 119, 182, 0.08)', padding: '0.75rem 1rem', borderRadius: '8px', fontSize: '0.85rem', color: '#0077b6', border: '1px solid rgba(0, 119, 182, 0.25)', textAlign: 'center', fontWeight: 600 }}>
              {multiplayerStatus}
            </div>

            {activeRoomId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center', background: 'rgba(15, 23, 42, 0.04)', padding: '1.25rem', borderRadius: '12px', border: '1px solid rgba(0, 119, 182, 0.2)' }}>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '2px', fontWeight: 700 }}>ROOM CODE</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', margin: '6px 0' }}>
                    <div style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '6px', color: '#0077b6', fontFamily: 'Orbitron, sans-serif' }}>
                      {activeRoomId}
                    </div>
                    <button
                      type="button"
                      title="Copy Room Code"
                      onClick={() => {
                        navigator.clipboard?.writeText(activeRoomId);
                        setCopiedCode(true);
                        setTimeout(() => setCopiedCode(false), 2000);
                      }}
                      style={{
                        background: copiedCode ? 'rgba(42, 157, 143, 0.15)' : 'rgba(0, 119, 182, 0.1)',
                        border: '1px solid ' + (copiedCode ? '#2a9d8f' : '#0077b6'),
                        color: copiedCode ? '#2a9d8f' : '#0077b6',
                        borderRadius: '8px',
                        padding: '6px 10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        fontSize: '0.75rem',
                        fontWeight: 700,
                        transition: 'all 0.2s ease'
                      }}
                    >
                      {copiedCode ? <Check size={14} /> : <Copy size={14} />}
                      {copiedCode ? 'COPIED' : 'COPY'}
                    </button>
                  </div>
                  <span style={{ fontSize: '0.8rem', color: '#64748b' }}>Share this code with your friend to join.</span>
                </div>

                <div className="lobby-divider">PLAYERS ({playersList.length}/2)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {playersList.map((p, idx) => (
                    <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.65rem 1rem', background: 'rgba(255, 255, 255, 0.95)', border: '1px solid rgba(0, 0, 0, 0.08)', borderRadius: '8px', fontSize: '0.9rem', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                      <span style={{ fontWeight: 600, color: '#1e293b' }}>{p.name} {p.id === mpManagerRef.current?.socket?.id ? '(You)' : ''}</span>
                      <span style={{ color: p.role === 'host' ? '#0077b6' : '#e63946', fontWeight: 800, textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '1px', padding: '2px 8px', borderRadius: '4px', background: p.role === 'host' ? 'rgba(0, 119, 182, 0.1)' : 'rgba(230, 57, 70, 0.1)' }}>{p.role}</span>
                    </div>
                  ))}
                  {playersList.length === 1 && (
                    <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#64748b', fontStyle: 'italic', padding: '10px' }}>Waiting for opponent to connect...</div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <button onClick={handleCreateRoom} className="btn-primary">
                  Create Private Room
                </button>

                <div className="lobby-divider">OR JOIN EXISTING</div>

                <form onSubmit={handleJoinRoom} className="room-input-box">
                  <input
                    type="text"
                    placeholder="Enter 5-Letter Room Code"
                    value={roomIdInput}
                    onChange={(e) => setRoomIdInput(e.target.value)}
                    style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '8px', color: 'white', padding: '12px', outline: 'none', textAlign: 'center', fontFamily: 'Orbitron, sans-serif', textTransform: 'uppercase', letterSpacing: '2px' }}
                    maxLength={5}
                  />
                  <button type="submit" className="btn-secondary">Join</button>
                </form>
              </div>
            )}

            <button onClick={handleBackToMenu} className="btn-secondary back-to-menu-btn">
              <ArrowLeft size={16} />
              Return to main menu
            </button>
          </div>
        </div>
      )}

      {/* 3. ACTIVE GAMEPLAY SCREEN */}
      {screen === 'playing' && (
        <div style={{ width: '100%', height: '100%', flex: 1, position: 'relative' }}>
          
          {/* 3D WebGL Canvas */}
          <GameCanvas
            physics={physicsRef.current}
            gameState={currentGameState}
            mode={mode}
            activeRoomId={activeRoomId}
            socket={mpManagerRef.current}
            isARMode={isARMode}
            setIsARMode={setIsARMode}
            activeReplayFrame={activeReplayFrame}
            isHandTracking={isHandTracking}
            webcamElement={webcamElement}
            setHandSpeed={setHandSpeed}
            isPhoneControllerActive={phoneRacketActive && phoneRacketConnected}
            phoneControllerData={phoneControllerData}
            onPaddleHit={(hitter, speed) => {
              if (phoneRacketActive && phoneRacketConnected && desktopSocket) {
                // Emit event to trigger mobile haptics & sound
                desktopSocket.emit('paddle-hit-feedback', { roomId: code, hitter, speed });
                // Sync current score card and speed reading to mobile dashboard
                desktopSocket.emit('game-state-sync', {
                  roomId: code,
                  score: physicsRef.current.score,
                  lastSwingSpeed: speed
                });
              }
            }}
          />

          {/* Core HUD HUD Overlay */}
          <div className="game-hud glassmorphism">
            <div className="player-score-card">
              <span className="score-name">{playerName}</span>
              <span className="score-value cyan">{score.player}</span>
            </div>
            <span className="score-divider">VS</span>
            <div className="player-score-card">
              <span className="score-name">{mode === 'singleplayer' ? 'AI Coach' : 'Opponent'}</span>
              <span className="score-value magenta">{score.opponent}</span>
            </div>
          </div>

          {/* Left panel options (Voice controls & Local scoreboard) */}
          <div className="side-panel-left">
            <button onClick={handleBackToMenu} className="btn-secondary" style={{ padding: '0.6rem 1rem' }}>
              <ArrowLeft size={16} />
              Quit Match
            </button>

            {/* Hand Tracking Camera controller preview */}
            {isHandTracking && (
              <div className="hand-tracking-preview-card glassmorphism">
                <div className="hand-tracking-title">
                  <span>Hand Controller</span>
                  <div className="webcam-status-indicator">
                    <span className="dot" style={{ backgroundColor: '#2a9d8f', width: 6, height: 6, borderRadius: '50%', display: 'inline-block' }}></span>
                    <span>ACTIVE</span>
                  </div>
                </div>
                <div className="webcam-feed-container">
                  <video ref={setWebcamElement} className="webcam-feed-video" autoPlay playsInline muted />
                </div>
                
                {/* Real-time Hand Velocity Meter */}
                <div style={{ marginTop: '8px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-secondary)', fontFamily: 'Orbitron, sans-serif' }}>
                    <span>Swipe Speed</span>
                    <span style={{ color: handSpeed > 3.0 ? '#e63946' : '#0077b6' }}>
                      {(handSpeed * 1.5).toFixed(1)} m/s
                    </span>
                  </div>
                  <div style={{ width: '100%', height: '6px', background: 'rgba(0,0,0,0.06)', borderRadius: '3px', overflow: 'hidden', marginTop: '4px' }}>
                    <div
                      style={{
                        width: `${Math.min(handSpeed * 18, 100)}%`,
                        height: '100%',
                        background: 'linear-gradient(to right, #0077b6, #e63946)',
                        borderRadius: '3px',
                        transition: 'width 0.08s ease'
                      }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* Voice Command Assistant */}
            <VoiceControls onCommand={handleVoiceCommand} gameState={currentGameState} />
            
            {/* Quick Actions */}
            <div className="glassmorphism" style={{ padding: '1rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <button
                onClick={() => setIsARMode(!isARMode)}
                className={`btn-primary ${isARMode ? 'active' : ''}`}
                style={{ background: isARMode ? 'linear-gradient(135deg, #ff007f 0%, #7f00ff 100%)' : '', fontSize: '0.8rem', padding: '10px 14px' }}
              >
                <Video size={14} />
                {isARMode ? 'Disable AR Mode' : 'Enable Camera AR'}
              </button>
              
              {mode === 'singleplayer' && (
                <button onClick={handleResetMatch} className="btn-secondary" style={{ fontSize: '0.8rem', padding: '10px 14px' }}>
                  <RotateCcw size={14} />
                  Reset Score
                </button>
              )}
            </div>
          </div>

          {/* Right panel options (Live Heatmap, last point replay link) */}
          <div className="side-panel-right">
            {/* Bounce Heatmap */}
            <HeatmapOverlay rallyLog={rallyLog} />
            
            {/* Live Point Replay toggle */}
            {rallyLog.length > 0 && !isReplaying && (
              <button
                onClick={() => handleTriggerReplay(rallyLog[rallyLog.length - 1])}
                className="btn-neon-cyan float-animation"
                style={{ padding: '10px 14px', fontSize: '0.8rem', width: '100%', gap: '6px' }}
              >
                <Eye size={14} />
                Watch Last Rally Replay
              </button>
            )}
          </div>

          {/* Floating Point-Replay controller */}
          {isReplaying && (
            <ReplayControls
              rallyRecord={selectedRallyForReplay}
              onFrameUpdate={setActiveReplayFrame}
              onClose={handleCloseReplay}
            />
          )}

          {/* Server status overlay for multiplayer */}
          {mode === 'multiplayer' && (
            <div className="multiplayer-status-panel glassmorphism">
              <span className="status-active-room">Room: {activeRoomId}</span>
              <span className="status-players-count"> | Ping Sync: Active</span>
            </div>
          )}
        </div>
      )}

      {/* 4. POST MATCH DASHBOARD */}
      {screen === 'postmatch' && (
        <div style={{ overflowY: 'auto', flex: 1, padding: '2rem 1rem' }}>
          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <h2 className="menu-title" style={{ fontSize: '2.5rem' }}>Match Completed</h2>
            <p className="menu-subtitle">Coaching Report & Shot Placements</p>
          </div>

          <div className="post-match-container">
            <div className="post-match-main">
              {/* Scoreboard display */}
              <div className="glassmorphism" style={{ padding: '2rem', display: 'flex', alignItems: 'center', justifyContent: 'space-around' }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2rem', color: '#00f3ff', fontWeight: 'bold' }}>{playerName}</div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, fontFamily: 'Orbitron' }}>{score.player}</div>
                </div>
                <div style={{ fontSize: '2rem', color: '#8892b0', fontFamily: 'Orbitron' }}>-</div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: '1.2rem', color: '#ff007f', fontWeight: 'bold' }}>{mode === 'singleplayer' ? 'AI Coach' : 'Opponent'}</div>
                  <div style={{ fontSize: '3rem', fontWeight: 900, fontFamily: 'Orbitron' }}>{score.opponent}</div>
                </div>
              </div>

              {/* Match Stats Grid */}
              <div className="stats-grid">
                <div className="stat-card glassmorphism">
                  <span className="stat-card-title">Max Ball Velocity</span>
                  <span className="stat-card-value" style={{ color: '#39ff14' }}>{speedKmh} km/h</span>
                </div>
                <div className="stat-card glassmorphism">
                  <span className="stat-card-title">Longest Rally Bounces</span>
                  <span className="stat-card-value" style={{ color: '#00f3ff' }}>{maxRallyLength} Hits</span>
                </div>
                <div className="stat-card glassmorphism">
                  <span className="stat-card-title">Total Points Scored</span>
                  <span className="stat-card-value">{score.player + score.opponent} pts</span>
                </div>
                <div className="stat-card glassmorphism">
                  <span className="stat-card-title">Rallies Recorded</span>
                  <span className="stat-card-value">{rallyLog.length}</span>
                </div>
              </div>

              {/* Match Replays List */}
              <div className="glassmorphism" style={{ padding: '1.5rem' }}>
                <h3 style={{ fontFamily: 'Orbitron', fontSize: '0.9rem', marginBottom: '10px', letterSpacing: '1px' }}>RALLY REPLAY LOGS</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '180px', overflowY: 'auto' }}>
                  {rallyLog.map((rally, idx) => (
                    <div key={idx} style={{ display: 'flex', justifyStyle: 'center', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.85rem' }}>
                      <span>Rally #{idx + 1} ({rally.bounces.length} bounces) - Winner: {rally.winner === 'player' ? 'You' : 'Opponent'}</span>
                      <button
                        onClick={() => {
                          setScreen('playing');
                          handleTriggerReplay(rally);
                        }}
                        className="btn-primary"
                        style={{ padding: '6px 12px', fontSize: '0.75rem', borderRadius: '4px' }}
                      >
                        Replay
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="post-match-side">
              {/* Navigation Tabs for Postmatch */}
              <div className="tabs-header">
                <button onClick={() => setActiveTab('coach')} className={`tab-btn ${activeTab === 'coach' ? 'active' : ''}`}>AI Coach</button>
                <button onClick={() => setActiveTab('stats')} className={`tab-btn ${activeTab === 'stats' ? 'active' : ''}`}>Heatmap</button>
                <button onClick={() => setActiveTab('leader')} className={`tab-btn ${activeTab === 'leader' ? 'active' : ''}`}>Leaderboard</button>
              </div>

              {/* Tab Contents */}
              {activeTab === 'coach' && (
                <AICoach
                  score={score}
                  rallyLog={rallyLog}
                  maxSpeed={maxSpeed}
                  maxRallyLength={maxRallyLength}
                />
              )}

              {activeTab === 'stats' && (
                <HeatmapOverlay rallyLog={rallyLog} />
              )}

              {activeTab === 'leader' && (
                <Leaderboard matchResult={matchResult} />
              )}

              <button onClick={handleBackToMenu} className="btn-primary" style={{ width: '100%', marginTop: '1rem', padding: '1rem' }}>
                Return to main menu
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 5. MOBILE CONTROLLER SCREEN */}
      {screen === 'controller-mobile' && (
        <div 
          className="mobile-controller-screen"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
        >
          <h1 className="controller-title float-animation">Hyperspace Racket</h1>
          <p className="controller-subtitle">Low-Latency Gyro Controller</p>
          
          <div className="controller-card glassmorphism">
            <div className="connection-badge">
              <span className={`dot ${isMobileConnected ? 'connected' : 'disconnected'}`}></span>
              <span>{isMobileConnected ? `Room: ${controllerRoomId} • CONNECTED` : 'DISCONNECTED'}</span>
            </div>

            {!isCalibrated ? (
              <div className="setup-view">
                <p className="setup-help">Hold your phone in your dominant hand, horizontally or vertically like a real table tennis racket, and tap calibrate to lock standard baseline orientation.</p>
                <button onClick={handleStartMobileController} className="btn-neon-cyan" style={{ padding: '16px 24px', width: '100%', fontSize: '1.1rem', marginTop: '10px' }}>
                  Calibrate & Start
                </button>
              </div>
            ) : (
              <div className="active-view">
                {/* 3D Dashboard HUD Panel */}
                <div className="mobile-hud-dashboard" style={{
                  backgroundColor: 'rgba(10, 11, 20, 0.65)',
                  border: '1px solid rgba(0, 243, 255, 0.25)',
                  borderRadius: '12px',
                  padding: '14px',
                  marginBottom: '15px',
                  boxShadow: '0 0 15px rgba(0, 243, 255, 0.1)',
                  fontFamily: 'sans-serif',
                  textAlign: 'left'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <span style={{ fontSize: '0.8rem', color: '#8892b0', textTransform: 'uppercase', letterSpacing: '1px' }}>MATCH SCORE</span>
                    <span style={{ fontSize: '0.75rem', color: '#ff007f', fontWeight: 'bold' }}>LIVE SYNC</span>
                  </div>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center', margin: '8px 0' }}>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#00f3ff' }}>YOU</div>
                      <div style={{ fontSize: '2rem', fontWeight: '900', color: '#ffffff', textShadow: '0 0 10px rgba(255,255,255,0.4)' }}>{mobileScore.player}</div>
                    </div>
                    <div style={{ fontSize: '1.5rem', color: '#ff007f', fontWeight: '900' }}>:</div>
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: '0.75rem', color: '#ff007f' }}>AI COACH</div>
                      <div style={{ fontSize: '2rem', fontWeight: '900', color: '#ffffff', textShadow: '0 0 10px rgba(255,255,255,0.4)' }}>{mobileScore.opponent}</div>
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid rgba(255, 255, 255, 0.08)', margin: '10px 0' }}></div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
                    <div>
                      <span style={{ color: '#8892b0' }}>Last Hit Speed: </span>
                      <span style={{ color: '#00f3ff', fontWeight: 'bold' }}>{mobileLastSpeed.toFixed(1)} m/s</span>
                    </div>
                    <div>
                      <span style={{ color: '#8892b0' }}>Spin: </span>
                      <span style={{ 
                        color: mobileSpinType === 'topspin' ? '#00f3ff' : (mobileSpinType === 'backspin' ? '#ff007f' : '#ffffff'),
                        fontWeight: 'bold',
                        textTransform: 'uppercase'
                      }}>{mobileSpinType}</span>
                    </div>
                  </div>
                </div>
                {!gyroActive && (
                  <div className="sensor-warning" style={{
                    backgroundColor: 'rgba(255, 68, 68, 0.15)',
                    border: '1px solid #ff4444',
                    borderRadius: '8px',
                    padding: '12px',
                    marginBottom: '15px',
                    fontSize: '0.85rem',
                    color: '#ffdddd',
                    textAlign: 'center',
                    lineHeight: '1.4'
                  }}>
                    <strong>⚠️ Gyroscope Inactive / Blocked</strong><br />
                    Swipe anywhere on this screen to move the racket.<br />
                    <span style={{ fontSize: '0.75rem', opacity: 0.8 }}>
                      To enable gyro: Use Chrome Flags on Android, or HTTPS (Port 3006) on iOS.
                    </span>
                  </div>
                )}
                {/* Animated Racket Visualizer */}
                <div className="racket-visualizer-container">
                  <div 
                    className="racket-visualizer"
                    style={{
                      transform: window.innerWidth > window.innerHeight
                        ? `rotateZ(${-gyroDebug.beta}deg) rotateX(${gyroDebug.gamma}deg)`
                        : `rotateZ(${-gyroDebug.gamma}deg) rotateX(${gyroDebug.beta}deg)`,
                      transition: 'transform 0.05s ease-out'
                    }}
                  >
                    <div className="racket-head"></div>
                    <div className="racket-handle"></div>
                  </div>
                </div>

                <div className="gyro-readings-grid">
                  <div className="reading-box">
                    <span className="reading-lbl">Pitch (X)</span>
                    <span className="reading-val">{gyroDebug.beta}°</span>
                  </div>
                  <div className="reading-box">
                    <span className="reading-lbl">Roll (Z)</span>
                    <span className="reading-val">{gyroDebug.gamma}°</span>
                  </div>
                  <div className="reading-box">
                    <span className="reading-lbl">Swing Acceleration</span>
                    <span className="reading-val">{gyroDebug.accel.toFixed(1)} m/s²</span>
                  </div>
                </div>

                <button onClick={handleMobileServe} className="btn-neon-magenta serve-btn" style={{ padding: '16px 24px', width: '100%', fontSize: '1.2rem', fontWeight: 'bold', marginBottom: '12px' }}>
                  TAP TO SERVE
                </button>

                <button onClick={handleRecalibrate} className="btn-secondary" style={{ padding: '12px 20px', width: '100%' }}>
                  Recalibrate Baseline
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
