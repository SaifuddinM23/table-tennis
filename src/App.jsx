import React, { useState, useEffect, useRef } from 'react';
import { Play, Users, Trophy, BrainCircuit, RotateCcw, Video, Eye, ArrowLeft, Send } from 'lucide-react';
import { PingPongPhysics } from './physics/PingPongPhysics';
import GameCanvas from './components/GameCanvas';
import VoiceControls from './components/VoiceControls';
import HeatmapOverlay from './components/HeatmapOverlay';
import AICoach from './components/AICoach';
import Leaderboard from './components/Leaderboard';
import { MultiplayerManager } from './components/MultiplayerManager';

const LOCAL_SERVER_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:3001' 
  : window.location.origin;

export default function App() {
  const [playerName, setPlayerName] = useState(() => localStorage.getItem('pingpong_player_name') || 'Player 1');
  const [screen, setScreen] = useState('menu'); // menu, lobby, playing, postmatch
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
  const [playersList, setPlayersList] = useState([]);
  const [role, setRole] = useState(null);
  const [matchResult, setMatchResult] = useState(null);
  const [isHandTracking, setIsHandTracking] = useState(false);
  const [difficulty, setDifficulty] = useState('medium');
  const [handSpeed, setHandSpeed] = useState(0);

  const physicsRef = useRef(new PingPongPhysics());
  const mpManagerRef = useRef(null);
  const webcamVideoRef = useRef(null);

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
          setScore({ player: physics.score.player, opponent: physics.score.opponent });
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
                  onChange={(e) => setIsHandTracking(e.target.checked)}
                  style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                />
                <span>Enable Camera Hand Controller</span>
              </label>
            </div>

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

            <div style={{ background: 'rgba(0,0,0,0.25)', padding: '1rem', borderRadius: '8px', fontSize: '0.85rem', color: '#00f3ff', border: '1px solid rgba(0, 243, 255, 0.15)', textAlign: 'center' }}>
              {multiplayerStatus}
            </div>

            {activeRoomId ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                <div style={{ textAlign: 'center' }}>
                  <span style={{ fontSize: '0.75rem', color: '#8892b0', textTransform: 'uppercase', letterSpacing: '1px' }}>Room Code:</span>
                  <div style={{ fontSize: '2rem', fontWeight: 900, letterSpacing: '4px', color: 'white', fontFamily: 'Orbitron, sans-serif', textShadow: '0 0 10px rgba(255,255,255,0.2)', margin: '4px 0' }}>{activeRoomId}</div>
                  <span style={{ fontSize: '0.75rem', color: '#8892b0' }}>Share this code with your friend to join.</span>
                </div>

                <div className="lobby-divider">PLAYERS ({playersList.length}/2)</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {playersList.map((p, idx) => (
                    <div key={p.id} style={{ display: 'flex', justifyStyle: 'center', justifyContent: 'space-between', padding: '0.6rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '6px', fontSize: '0.9rem' }}>
                      <span>{p.name} {p.id === mpManagerRef.current?.socket?.id ? '(You)' : ''}</span>
                      <span style={{ color: p.role === 'host' ? '#00f3ff' : '#ff007f', fontWeight: 'bold', textTransform: 'uppercase', fontSize: '0.75rem', letterSpacing: '1px' }}>{p.role}</span>
                    </div>
                  ))}
                  {playersList.length === 1 && (
                    <div style={{ textAlign: 'center', fontSize: '0.8rem', color: '#8892b0', fontStyle: 'italic', padding: '10px' }}>Waiting for connection...</div>
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
            webcamVideoRef={webcamVideoRef}
            setHandSpeed={setHandSpeed}
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
                  <video ref={webcamVideoRef} className="webcam-feed-video" autoPlay playsInline muted />
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
    </div>
  );
}
