import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Play, RotateCcw, Video } from 'lucide-react';

export default function GameCanvas({ physics, gameState, mode, activeRoomId, socket, isARMode, setIsARMode, activeReplayFrame, isHandTracking, webcamVideoRef, setHandSpeed }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const requestRef = useRef(null);
  
  // Three.js internal refs
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const ballMeshRef = useRef(null);
  const playerPaddleMeshRef = useRef(null);
  const opponentPaddleMeshRef = useRef(null);
  const trailMeshesRef = useRef([]);

  // Input tracking refs
  const mouseRef = useRef({ x: 0, y: 0, tiltX: 0, tiltZ: 0 });
  const playerPaddlePosRef = useRef({ x: 0, y: 0.15, z: 1.35, vx: 0, vy: 0, vz: 0 });
  const opponentPaddlePosRef = useRef({ x: 0, y: 0.15, z: -1.35, vx: 0, vy: 0, vz: 0 });
  const prevTimeRef = useRef(0);

  // 1. Handle Simulated AR Camera Stream
  useEffect(() => {
    if (isARMode && !navigator.xr) {
      // Setup Simulated AR camera
      navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
        .then((stream) => {
          setCameraStream(stream);
          if (videoRef.current) {
            videoRef.current.srcObject = stream;
          }
        })
        .catch((err) => {
          console.error("Camera access failed for simulated AR mode", err);
          setIsARMode(false);
        });
    } else {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        setCameraStream(null);
      }
    }

    return () => {
      if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isARMode]);

  // 2. Initialize Three.js Scene
  useEffect(() => {
    if (!containerRef.current) return;

    const Y_OFFSET = 0.25; // Render Y height offset for table and paddles
    // Use window dimensions as fallback — containerRef may have 0 size before browser layout
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    // SCENE
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // CAMERA
    const camera = new THREE.PerspectiveCamera(75, width / height, 0.1, 100);
    // Position camera looking down from player end (adjusted higher and further back)
    camera.position.set(0, 1.75, 2.5);
    camera.lookAt(0, 0.15 + Y_OFFSET, -0.45);
    cameraRef.current = camera;

    // RENDERER — no alpha so the scene background renders correctly
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    // Ensure canvas fills the container fully
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.display = 'block';
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // LIGHTS
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.25);
    dirLight.position.set(2, 4, 3);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far = 15;
    dirLight.shadow.bias = -0.001;
    scene.add(dirLight);

    // Neon Accent Lights
    const playerLight = new THREE.PointLight(0x00f3ff, 0.8, 4);
    playerLight.position.set(0, 0.5, 1.4);
    scene.add(playerLight);

    const opponentLight = new THREE.PointLight(0xff007f, 0.8, 4);
    opponentLight.position.set(0, 0.5, -1.4);
    scene.add(opponentLight);

    // 3D ENVIRONMENT (Render standard starry skybox if not in AR mode)
    let skybox;
    if (!isARMode) {
      scene.background = new THREE.Color(0xf8fafc); // Light mode background slate-50
      // Grid helper for futuristic environment floor
      const gridHelper = new THREE.GridHelper(30, 30, 0x0077b6, 0xdde2eb);
      gridHelper.position.y = -0.76 + Y_OFFSET;
      scene.add(gridHelper);
    } else {
      scene.background = null; // transparent background for AR overlay
    }

    // TABLE
    // Dimensions: x = 1.525, y = 0.04, z = 2.74
    const tableGeom = new THREE.BoxGeometry(1.525, 0.04, 2.74);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x0077b6, // premium sky blue table
      roughness: 0.18,
      metalness: 0.2,
      side: THREE.DoubleSide
    });
    const tableMesh = new THREE.Mesh(tableGeom, tableMat);
    tableMesh.position.y = -0.02 + Y_OFFSET;
    tableMesh.receiveShadow = true;
    scene.add(tableMesh);

    // Table Lines (border and middle lines)
    const lineThickness = 0.015;
    const linesGroup = new THREE.Group();

    // White outer border line
    const borderGeom = new THREE.BoxGeometry(1.525 + 0.002, 0.042, 2.74 + 0.002);
    const borderMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true });
    const borderLine = new THREE.Mesh(borderGeom, borderMat);
    borderLine.position.y = -0.02 + Y_OFFSET;
    linesGroup.add(borderLine);

    // Center dividing line (for doubles, standard style decoration)
    const centerLineGeom = new THREE.PlaneGeometry(0.008, 2.74);
    const centerLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const centerLine = new THREE.Mesh(centerLineGeom, centerLineMat);
    centerLine.rotation.x = -Math.PI / 2;
    centerLine.position.set(0, 0.021 + Y_OFFSET, 0);
    linesGroup.add(centerLine);

    scene.add(linesGroup);

    // Table Legs (4 neon tubes)
    const legGeom = new THREE.CylinderGeometry(0.02, 0.02, 0.76 + Y_OFFSET);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1b1b2f, emissive: 0x0077b6, emissiveIntensity: 0.3 });
    const legs = [
      { x: -0.7, z: -1.3 },
      { x: 0.7, z: -1.3 },
      { x: -0.7, z: 1.3 },
      { x: 0.7, z: 1.3 }
    ];
    legs.forEach(pos => {
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(pos.x, -(0.76 + Y_OFFSET) / 2 + Y_OFFSET, pos.z);
      scene.add(leg);
    });

    // NET
    // Dimensions: Height = 0.1525, Width = TABLE_WIDTH + 0.15 (1.525 + 0.15)
    const netWidth = 1.525 + 0.15;
    const netGeom = new THREE.PlaneGeometry(netWidth, 0.1525);
    // Grid pattern net texture
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const netCtx = netCanvas.getContext('2d');
    netCtx.strokeStyle = '#ffffff';
    netCtx.lineWidth = 2;
    netCtx.strokeRect(0, 0, 64, 64);
    netCtx.beginPath();
    netCtx.moveTo(0, 32); netCtx.lineTo(64, 32);
    netCtx.moveTo(32, 0); netCtx.lineTo(32, 64);
    netCtx.stroke();

    const netTexture = new THREE.CanvasTexture(netCanvas);
    netTexture.wrapS = THREE.RepeatWrapping;
    netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(20, 2);

    const netMat = new THREE.MeshStandardMaterial({
      map: netTexture,
      transparent: true,
      opacity: 0.8,
      side: THREE.DoubleSide
    });
    const netMesh = new THREE.Mesh(netGeom, netMat);
    netMesh.position.set(0, 0.1525 / 2 + Y_OFFSET, 0);
    scene.add(netMesh);

    // Net top strip
    const topStripGeom = new THREE.BoxGeometry(netWidth, 0.01, 0.005);
    const topStripMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const topStrip = new THREE.Mesh(topStripGeom, topStripMat);
    topStrip.position.set(0, 0.1525 + Y_OFFSET, 0);
    scene.add(topStrip);

    // BALL
    const ballGeom = new THREE.SphereGeometry(0.02, 32, 32);
    const ballMat = new THREE.MeshStandardMaterial({
      color: 0xffaa00,
      emissive: 0xff5500,
      emissiveIntensity: 0.35,
      roughness: 0.2
    });
    const ballMesh = new THREE.Mesh(ballGeom, ballMat);
    ballMesh.castShadow = true;
    scene.add(ballMesh);
    ballMeshRef.current = ballMesh;

    // BALL TRAIL - neon glow bubbles
    const trailGeom = new THREE.SphereGeometry(0.012, 16, 16);
    const trailMat = new THREE.MeshBasicMaterial({
      color: 0x39ff14,
      transparent: true,
      opacity: 0.5
    });
    const trailMeshes = [];
    for (let i = 0; i < 15; i++) {
      const trailNode = new THREE.Mesh(trailGeom, trailMat.clone());
      trailNode.visible = false;
      scene.add(trailNode);
      trailMeshes.push(trailNode);
    }
    trailMeshesRef.current = trailMeshes;

    // PADDLES
    // Dimensions: Radius = 0.1 (diameter = 0.2), Thickness = 0.012
    const paddleGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.012, 32);
    paddleGeom.rotateX(Math.PI / 2); // orient circular face towards net

    // Player Paddle (Neon Cyan)
    const playerPaddleMat = new THREE.MeshStandardMaterial({
      color: 0x00f3ff,
      roughness: 0.3,
      metalness: 0.5
    });
    const playerPaddleMesh = new THREE.Group();
    const playerPaddleBlade = new THREE.Mesh(paddleGeom, playerPaddleMat);
    playerPaddleBlade.castShadow = true;
    playerPaddleMesh.add(playerPaddleBlade);
    
    // Paddle Handle
    const handleGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.12, 16);
    const handleMat = new THREE.MeshStandardMaterial({ color: 0x222222 });
    const playerPaddleHandle = new THREE.Mesh(handleGeom, handleMat);
    playerPaddleHandle.position.set(0, -0.14, 0);
    playerPaddleMesh.add(playerPaddleHandle);
    
    scene.add(playerPaddleMesh);
    playerPaddleMeshRef.current = playerPaddleMesh;

    // Opponent Paddle (Neon Magenta)
    const opponentPaddleMat = new THREE.MeshStandardMaterial({
      color: 0xff007f,
      roughness: 0.3,
      metalness: 0.5
    });
    const opponentPaddleMesh = new THREE.Group();
    const opponentPaddleBlade = new THREE.Mesh(paddleGeom, opponentPaddleMat);
    opponentPaddleBlade.castShadow = true;
    opponentPaddleMesh.add(opponentPaddleBlade);
    
    const opponentPaddleHandle = new THREE.Mesh(handleGeom, handleMat);
    opponentPaddleHandle.position.set(0, -0.14, 0);
    opponentPaddleMesh.add(opponentPaddleHandle);

    scene.add(opponentPaddleMesh);
    opponentPaddleMeshRef.current = opponentPaddleMesh;

    // 4. Input Events / Controls
    const handleMouseMove = (e) => {
      // Normalize coordinate: -1 to +1
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    };

    const handleTouchMove = (e) => {
      if (e.touches.length === 0) return;
      const rect = renderer.domElement.getBoundingClientRect();
      mouseRef.current.x = ((e.touches[0].clientX - rect.left) / rect.width) * 2 - 1;
      mouseRef.current.y = -((e.touches[0].clientY - rect.top) / rect.height) * 2 + 1;
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('touchmove', handleTouchMove);

    // 5. Handle Resize — use window dimensions as fallback for absolute-positioned containers
    const handleResize = () => {
      if (!rendererRef.current) return;
      const w = (containerRef.current?.clientWidth) || window.innerWidth;
      const h = (containerRef.current?.clientHeight) || window.innerHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);
    // Call immediately to fix dimensions if container was 0×0 at init time
    setTimeout(handleResize, 100);

    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('resize', handleResize);
      if (rendererRef.current && containerRef.current) {
        try {
          containerRef.current.removeChild(renderer.domElement);
        } catch (e) {}
      }
      renderer.dispose();
    };
  }, [isARMode]);

  // 3. WebXR Session (Mobile / VR AR support)
  useEffect(() => {
    if (!rendererRef.current || !isARMode || !navigator.xr) return;
    
    // Standard WebXR session request if supported
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (supported) {
        const xr = rendererRef.current.xr;
        xr.enabled = true;
        
        // Request WebXR AR Session
        navigator.xr.requestSession('immersive-ar', {
          requiredFeatures: ['local-floor', 'hit-test']
        }).then((session) => {
          xr.setSession(session);
          session.addEventListener('end', () => {
            setIsARMode(false);
          });
        });
      }
    });
  }, [isARMode]);

  // 4. Main Animation & Physics update loop
  useEffect(() => {
    let lastTime = performance.now();

    const loop = (time) => {
      requestRef.current = requestAnimationFrame(loop);

      const dt = Math.max(0.001, Math.min((time - lastTime) / 1000, 0.032)); // cap dt at 30fps to avoid big leaps
      lastTime = time;

      const scene = sceneRef.current;
      const camera = cameraRef.current;
      const renderer = rendererRef.current;

      if (!scene || !camera || !renderer) return;

      if (activeReplayFrame) {
        // Direct replay rendering, bypassing active inputs and physics loops
        const ballMesh = ballMeshRef.current;
        if (ballMesh && activeReplayFrame.ball) {
          ballMesh.position.set(activeReplayFrame.ball.x, activeReplayFrame.ball.y + 0.25, activeReplayFrame.ball.z);
          ballMesh.rotation.x += (activeReplayFrame.ball.spinX || 0) * dt * 5;
          ballMesh.rotation.y += (activeReplayFrame.ball.spinY || 0) * dt * 5;
        }

        const playerPaddleMesh = playerPaddleMeshRef.current;
        if (playerPaddleMesh && activeReplayFrame.player) {
          playerPaddleMesh.position.set(activeReplayFrame.player.x, activeReplayFrame.player.y + 0.25, activeReplayFrame.player.z);
          playerPaddleMesh.rotation.set(0, 0, 0);
        }

        const opponentPaddleMesh = opponentPaddleMeshRef.current;
        if (opponentPaddleMesh && activeReplayFrame.opponent) {
          opponentPaddleMesh.position.set(activeReplayFrame.opponent.x, activeReplayFrame.opponent.y + 0.25, activeReplayFrame.opponent.z);
          opponentPaddleMesh.rotation.set(0, 0, 0);
        }

        // Hide active trial meshes in replay mode
        const trailMeshes = trailMeshesRef.current;
        trailMeshes.forEach(mesh => { mesh.visible = false; });

        renderer.render(scene, camera);
        return;
      }

      // Update Player Paddle position from mouse
      const playerPaddleMesh = playerPaddleMeshRef.current;
      if (playerPaddleMesh) {
        // Project mouse position onto 3D paddle plane
        // Let's map normalized mouse -1..1 to reasonable table coordinates
        // Table Width is 1.525. Allow paddle to move slightly outside boundaries.
        const targetX = mouseRef.current.x * 0.95;
        // Keep paddle vertical height bounded (table is at y=0, allow y up to 0.45)
        // Map mouse Y [-1, 1] linearly to [0.05, 0.55] for full unclamped control
        const targetY = THREE.MathUtils.clamp(0.28 + mouseRef.current.y * 0.25, 0.05, 0.55);
        // Player sits at z = 1.35
        const targetZ = 1.35;

        // Calculate paddle velocity
        const prevX = playerPaddlePosRef.current.x;
        const prevY = playerPaddlePosRef.current.y;
        const prevZ = playerPaddlePosRef.current.z;

        // Linear interpolation for smooth paddle movement
        playerPaddlePosRef.current.x += (targetX - prevX) * 0.28;
        playerPaddlePosRef.current.y += (targetY - prevY) * 0.28;
        playerPaddlePosRef.current.z = targetZ;

        // Calculate velocity vector and clamp to prevent extreme physics impulses on sudden jumps
        playerPaddlePosRef.current.vx = THREE.MathUtils.clamp((playerPaddlePosRef.current.x - prevX) / dt, -15, 15);
        playerPaddlePosRef.current.vy = THREE.MathUtils.clamp((playerPaddlePosRef.current.y - prevY) / dt, -15, 15);
        playerPaddlePosRef.current.vz = 0; // standard flat hitting

        // Sync mesh positions (raising visual height for camera visibility)
        // Add subtle breathing animation so the paddle is never completely static
        const playerIdleX = Math.sin(time * 0.003) * 0.012;
        const playerIdleY = Math.cos(time * 0.004) * 0.008;

        playerPaddleMesh.position.set(
          playerPaddlePosRef.current.x + playerIdleX,
          playerPaddlePosRef.current.y + 0.25 + playerIdleY,
          playerPaddlePosRef.current.z
        );

        // Tilt paddle realistically based on hand movement if hand tracking is active
        // Also add a subtle rotation sway so the racket never feels statically aligned
        const rotationSwayZ = Math.sin(time * 0.002) * 0.035;
        const rotationSwayX = Math.cos(time * 0.002) * 0.025;
        if (isHandTracking) {
          playerPaddleMesh.rotation.z = mouseRef.current.tiltZ + rotationSwayZ;
          playerPaddleMesh.rotation.x = mouseRef.current.tiltX + rotationSwayX;
        } else {
          // Fallback to velocity-based tilt for mouse/touch controls
          playerPaddleMesh.rotation.z = -playerPaddlePosRef.current.vx * 0.04 + rotationSwayZ;
          playerPaddleMesh.rotation.x = playerPaddlePosRef.current.vy * 0.03 + rotationSwayX;
        }
      }

      // Update Opponent / AI Paddle
      const opponentPaddleMesh = opponentPaddleMeshRef.current;
      if (opponentPaddleMesh) {
        if (mode === 'singleplayer') {
          // AI Logic: follow the ball when ball is coming towards AI side (vz < 0)
          const ball = physics.ball;
          const diff = physics.difficulty || 'medium';
          
          let targetX = 0;
          let targetY = 0.15;
          const targetZ = -1.35;

          // Capture positions BEFORE updating for velocity calculation
          const prevAIX = opponentPaddlePosRef.current.x;
          const prevAIY = opponentPaddlePosRef.current.y;

          if (ball.vz < 0 && ball.z < 0.8) {
            if (ball.z <= -1.15) {
              // Intercept phase: snap paddle close to ball to guarantee clean contact
              let precision = 0.95;
              if (diff === 'pro') {
                precision = 1.0;
              } else if (diff === 'medium') {
                precision = 0.82; // beatable
              } else if (diff === 'easy') {
                precision = 0.65; // very easy to beat
              } else {
                precision = 0.75;
              }
              opponentPaddlePosRef.current.x += (ball.x - opponentPaddlePosRef.current.x) * precision;
              opponentPaddlePosRef.current.y += (ball.y - opponentPaddlePosRef.current.y) * precision;
            } else {
              // Predict where the ball is landing on the AI's baseline
              const timeToAI = (targetZ - ball.z) / ball.vz;
              
              if (timeToAI > 0) {
                // Predict X coordinate intersection
                let predX = ball.x + ball.vx * timeToAI;
                predX = THREE.MathUtils.clamp(predX, -0.75, 0.75);

                // Predict Y coordinate (account for height)
                let predY = ball.y;
                if (ball.y <= 0) predY = 0.12;
                predY = THREE.MathUtils.clamp(predY + 0.08, 0.05, 0.45);

                // Apply tracking speed and precision offsets depending on difficulty
                let chaseFactor = 0.14;
                if (diff === 'pro') {
                  chaseFactor = 0.28; // extremely responsive
                  targetX = predX;
                  targetY = predY;
                } else if (diff === 'medium') {
                  chaseFactor = 0.10; // slightly slower response
                  targetX = predX + Math.sin(time * 0.003) * 0.12; // moderate lag wobble
                  targetY = predY;
                } else if (diff === 'easy') {
                  chaseFactor = 0.06; // slow response
                  targetX = predX + Math.sin(time * 0.004) * 0.22; // larger lag wobble
                  targetY = 0.15; // don't track height perfectly
                } else {
                  chaseFactor = 0.06;
                  targetX = predX + Math.sin(time * 0.005) * 0.2;
                  targetY = 0.15;
                }

                opponentPaddlePosRef.current.x += (targetX - opponentPaddlePosRef.current.x) * chaseFactor;
                opponentPaddlePosRef.current.y += (targetY - opponentPaddlePosRef.current.y) * chaseFactor;
              }
            }
          } else {
            // Return to center
            opponentPaddlePosRef.current.x += (0 - opponentPaddlePosRef.current.x) * 0.06;
            opponentPaddlePosRef.current.y += (0.15 - opponentPaddlePosRef.current.y) * 0.06;
          }
          
          opponentPaddlePosRef.current.z = targetZ;

          // Compute AI paddle velocities for collision impact (using prevAIX/Y captured BEFORE move)
          opponentPaddlePosRef.current.vx = (opponentPaddlePosRef.current.x - prevAIX) / dt;
          opponentPaddlePosRef.current.vy = (opponentPaddlePosRef.current.y - prevAIY) / dt;
          opponentPaddlePosRef.current.vz = 0;

           const opponentIdleX = Math.sin(time * 0.0025 + 2) * 0.012;
          const opponentIdleY = Math.cos(time * 0.0035 + 1) * 0.008;
          opponentPaddleMesh.position.set(
            opponentPaddlePosRef.current.x + opponentIdleX,
            opponentPaddlePosRef.current.y + 0.25 + opponentIdleY,
            opponentPaddlePosRef.current.z
          );

          // AI paddle rotation sway and tilt
          const aiSwayZ = Math.sin(time * 0.0025 + 1) * 0.035;
          const aiSwayX = Math.cos(time * 0.0025 + 1) * 0.025;
          opponentPaddleMesh.rotation.z = -opponentPaddlePosRef.current.vx * 0.04 + aiSwayZ;
          opponentPaddleMesh.rotation.x = opponentPaddlePosRef.current.vy * 0.03 + aiSwayX;
        } else if (mode === 'multiplayer') {
          // Multiplayer mode: Paddle positions are updated via Socket/RTC channel
          const opponentIdleX = Math.sin(time * 0.0025 + 2) * 0.012;
          const opponentIdleY = Math.cos(time * 0.0035 + 1) * 0.008;
          opponentPaddleMesh.position.set(
            opponentPaddlePosRef.current.x + opponentIdleX,
            opponentPaddlePosRef.current.y + 0.25 + opponentIdleY,
            opponentPaddlePosRef.current.z
          );
          // Sway multiplayer opponent paddle slightly
          opponentPaddleMesh.rotation.z = Math.sin(time * 0.0025 + 1.5) * 0.03;
          opponentPaddleMesh.rotation.x = Math.cos(time * 0.0025 + 1.5) * 0.02;
        }
      }

      // Physics loop tick
      if (mode === 'singleplayer' || (mode === 'multiplayer' && socket && socket.role === 'host')) {
        physics.update(dt, playerPaddlePosRef.current, opponentPaddlePosRef.current);
        
        // Multi player host relays state using the send() method of MultiplayerManager
        if (mode === 'multiplayer' && socket && socket.role === 'host') {
          socket.send({
            ball: physics.ball,
            opponentPaddle: playerPaddlePosRef.current, // host's paddle is client's opponent paddle
            gameState: physics.gameState,
            score: physics.score,
            servingPlayer: physics.servingPlayer,
            winner: physics.winner
          });
        }
      }

      // Render ball positions
      const ballMesh = ballMeshRef.current;
      if (ballMesh) {
        ballMesh.position.set(physics.ball.x, physics.ball.y + 0.25, physics.ball.z);
        // Spin rotations
        ballMesh.rotation.x += physics.ball.spinX * dt * 5;
        ballMesh.rotation.y += physics.ball.spinY * dt * 5;
      }

      // Update neon ball trails
      const trailMeshes = trailMeshesRef.current;
      const trailPoints = physics.ball.trail || [];
      trailMeshes.forEach((mesh, index) => {
        if (index < trailPoints.length) {
          const point = trailPoints[trailPoints.length - 1 - index];
          mesh.position.set(point.x, point.y + 0.25, point.z);
          mesh.visible = true;
          // Fade opacity based on index
          mesh.material.opacity = (1.0 - (index / trailMeshes.length)) * 0.45;
        } else {
          mesh.visible = false;
        }
      });

      // Render scene
      renderer.render(scene, camera);
    };

    requestRef.current = requestAnimationFrame(loop);

    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [physics, mode, activeRoomId, socket]);

  // Handle Multiplayer inbound network states
  useEffect(() => {
    if (mode !== 'multiplayer' || !socket) return;

    const handleInboundGameState = (state) => {
      if (socket.role === 'client') {
        // Sync ball positions and host paddle (client's opponent paddle)
        physics.ball.x = state.ball.x;
        physics.ball.y = state.ball.y;
        physics.ball.z = state.ball.z;
        physics.ball.vx = state.ball.vx;
        physics.ball.vy = state.ball.vy;
        physics.ball.vz = state.ball.vz;
        physics.ball.spinX = state.ball.spinX;
        physics.ball.spinY = state.ball.spinY;
        physics.ball.trail = state.ball.trail || [];

        opponentPaddlePosRef.current.x = state.opponentPaddle.x;
        opponentPaddlePosRef.current.y = state.opponentPaddle.y;
        opponentPaddlePosRef.current.z = -state.opponentPaddle.z; // mirror depth

        // Sync score and gameplay states from the host
        if (state.gameState) physics.gameState = state.gameState;
        if (state.score) physics.score = state.score;
        if (state.servingPlayer) physics.servingPlayer = state.servingPlayer;
        if (state.winner) physics.winner = state.winner;
      } else {
        // Host: Sync client paddle position (host's opponent paddle)
        opponentPaddlePosRef.current.x = -state.paddle.x; // mirror width
        opponentPaddlePosRef.current.y = state.paddle.y;
        opponentPaddlePosRef.current.z = -1.35;
      }
    };

    socket.on('game-state', handleInboundGameState);
    
    // Client sends paddle updates to Host using the send() method of MultiplayerManager
    let syncInterval;
    if (socket.role === 'client') {
      syncInterval = setInterval(() => {
        socket.send({
          paddle: playerPaddlePosRef.current
        });
      }, 16); // ~60fps
    }

    return () => {
      socket.off('game-state', handleInboundGameState);
      if (syncInterval) clearInterval(syncInterval);
    };
  }, [mode, socket, activeRoomId, physics]);

  // Store latest gameState and physics in refs to avoid stale closures in webcam stream callbacks
  const gameStateRef = useRef(gameState);
  const physicsRef = useRef(physics);

  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  useEffect(() => {
    physicsRef.current = physics;
  }, [physics]);

  // 5. MediaPipe Hands Camera tracking
  useEffect(() => {
    if (!isHandTracking || !webcamVideoRef || !webcamVideoRef.current) return;

    const videoElement = webcamVideoRef.current;
    
    // Check if MediaPipe scripts are loaded
    if (typeof window.Hands === 'undefined' || typeof window.Camera === 'undefined') {
      console.warn("MediaPipe Hands or Camera scripts not loaded yet.");
      return;
    }

    let cameraInstance = null;
    const hands = new window.Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6
    });

    let lastHandTime = performance.now();
    let lastHandX = 0.5;
    let lastHandY = 0.5;

    hands.onResults((results) => {
      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        // Landmark 9 is the center of the palm.
        const palmCenter = landmarks[9];
        
        // Map camera coordinates (0..1) to normalized mouse coordinate space (-1..1)
        // Camera width is mirrored: X close to 0 is hand on user's right (camera left)
        const rawX = (1.0 - palmCenter.x) * 2.0 - 1.0;
        // Map Y: camera Y = 0 is top, Y = 1 is bottom. Map to -1..1:
        const rawY = (1.0 - palmCenter.y) * 2.0 - 1.0;

        // Target coordinates with wider mapping range
        const targetMouseX = rawX * 1.6;
        const targetMouseY = rawY * 1.6;

        // Low-pass exponential smoothing filter (0.3 coefficient) for snappier tracking response
        if (isNaN(mouseRef.current.x)) mouseRef.current.x = 0;
        if (isNaN(mouseRef.current.y)) mouseRef.current.y = 0.15;

        mouseRef.current.x += (targetMouseX - mouseRef.current.x) * 0.3;
        mouseRef.current.y += (targetMouseY - mouseRef.current.y) * 0.3; 

        // Calculate realistic hand tilt angles (Roll and Pitch) from landmarks
        const p5 = landmarks[5];
        const p17 = landmarks[17];
        let roll = Math.atan2(p17.y - p5.y, p17.x - p5.x);
        
        // Align so a flat hand has 0 roll rotation
        if (roll > Math.PI / 2) roll -= Math.PI;
        if (roll < -Math.PI / 2) roll += Math.PI;
        const targetTiltZ = -roll * 1.3; // scale roll responsiveness

        // Pitch: compare middle finger tip (12) and middle finger knuckle (9)
        const p9 = landmarks[9];
        const p12 = landmarks[12];
        const fingerLengthY = p12.y - p9.y; // positive if finger points down, negative if up
        const targetTiltX = THREE.MathUtils.clamp(-fingerLengthY * 1.8, -0.6, 0.6);

        if (isNaN(mouseRef.current.tiltZ)) mouseRef.current.tiltZ = 0;
        if (isNaN(mouseRef.current.tiltX)) mouseRef.current.tiltX = 0;

        // Apply smooth interpolation to rotations to eliminate camera frame jitter
        mouseRef.current.tiltZ += (targetTiltZ - mouseRef.current.tiltZ) * 0.22;
        mouseRef.current.tiltX += (targetTiltX - mouseRef.current.tiltX) * 0.22;

        // CALCULATE HAND SPEED (distance delta / time delta)
        const now = performance.now();
        const dtHand = (now - lastHandTime) / 1000;
        lastHandTime = now;

        if (dtHand > 0) {
          const dxHand = palmCenter.x - lastHandX;
          const dyHand = palmCenter.y - lastHandY;
          const distHand = Math.sqrt(dxHand * dxHand + dyHand * dyHand);
          const rawSpeed = distHand / dtHand; // speed in units per second

          // If waiting for serve, a fast hand swipe starts the serve automatically
          if (gameStateRef.current === 'serve_player' && rawSpeed > 2.5) {
            physicsRef.current.serveBall('player');
          }

          if (setHandSpeed) {
            // Apply smoothing filter to prevent jittery gauge readings
            setHandSpeed((prev) => prev * 0.72 + rawSpeed * 0.28);
          }
        }
        lastHandX = palmCenter.x;
        lastHandY = palmCenter.y;
      }
    });

    // Start video capture
    navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, facingMode: 'user' } })
      .then((stream) => {
        videoElement.srcObject = stream;
        
        cameraInstance = new window.Camera(videoElement, {
          onFrame: async () => {
            if (isHandTracking) {
              try {
                await hands.send({ image: videoElement });
              } catch (e) {
                // ignore image capture frame errors
              }
            }
          },
          width: 320,
          height: 240
        });
        cameraInstance.start();
      })
      .catch((err) => {
        console.error("Failed to start hand tracking camera stream", err);
      });

    return () => {
      if (cameraInstance) {
        try {
          cameraInstance.stop();
        } catch (e) {}
      }
      if (videoElement.srcObject) {
        try {
          videoElement.srcObject.getTracks().forEach(track => track.stop());
        } catch (e) {}
        videoElement.srcObject = null;
      }
      try {
        hands.close();
      } catch (e) {}
    };
  }, [isHandTracking, webcamVideoRef]);

  const handleCanvasClick = () => {
    if (gameState === 'serve_player') {
      physics.serveBall('player');
    }
  };

  return (
    <div className="game-screen" onClick={handleCanvasClick} style={{ cursor: gameState === 'serve_player' ? 'pointer' : 'default' }}>
      {/* Video Background for Simulated AR camera overlay */}
      {isARMode && (
        <video
          ref={videoRef}
          className="ar-simulated-video"
          autoPlay
          playsInline
          muted
        />
      )}

      {/* Three.js Canvas container */}
      <div ref={containerRef} className="canvas-container" />

      {isARMode && (
        <div className="ar-help-overlay glassmorphism">
          <span>AR CAMERA FEED ACTIVE - Drag mouse or swipe screen to control paddle</span>
        </div>
      )}

      {/* In-game serving alerts */}
      {gameState === 'serve_player' && (
        <div className="status-toast pulse-animation">
          Your Turn to Serve! Press Space, Click Screen, or Swipe Hand
        </div>
      )}
      {gameState === 'serve_opponent' && (
        <div className="status-toast pulse-animation">
          Opponent Serving... Get Ready!
        </div>
      )}
    </div>
  );
}
