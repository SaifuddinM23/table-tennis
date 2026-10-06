import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { Play, RotateCcw, Video } from 'lucide-react';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const Y_OFFSET = 0.25; // Render Y height offset for table and paddles

export default function GameCanvas({ physics, gameState, mode, activeRoomId, socket, isARMode, setIsARMode, activeReplayFrame, isHandTracking, webcamElement, setHandSpeed, isPhoneControllerActive, phoneControllerData, onPaddleHit }) {
  const containerRef = useRef(null);
  const videoRef = useRef(null);
  const [cameraStream, setCameraStream] = useState(null);
  const requestRef = useRef(null);
  const lastTapServedRef = useRef(false);
  
  // Three.js internal refs
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const ballMeshRef = useRef(null);
  const playerPaddleMeshRef = useRef(null);
  const opponentPaddleMeshRef = useRef(null);
  const trailMeshesRef = useRef([]);
  const opponentAvatarRef = useRef(null);

  // Refs to prevent stale closures inside Three.js rendering loop
  const phoneControllerDataRef = useRef(phoneControllerData);
  const isPhoneControllerActiveRef = useRef(isPhoneControllerActive);

  // Keep refs synchronized with React props
  phoneControllerDataRef.current = phoneControllerData;
  isPhoneControllerActiveRef.current = isPhoneControllerActive;

  // Input tracking refs
  const mouseRef = useRef({ x: 0, y: 0, tiltX: 0, tiltZ: 0 });
  const playerPaddlePosRef = useRef({ x: 0, y: 0.15, z: 1.35, vx: 0, vy: 0, vz: 0 });
  const opponentPaddlePosRef = useRef({ x: 0, y: 0.15, z: -1.35, vx: 0, vy: 0, vz: 0 });
  const prevTimeRef = useRef(0);
  const opponentSwingTimeRef = useRef(0); // tracks active hit swing animation progress

  // Connect paddle hit callback to physics engine
  useEffect(() => {
    if (physics) {
      physics.onPaddleHit = (hitter, speed) => {
        if (onPaddleHit) {
          onPaddleHit(hitter, speed);
        }
        if (hitter === 'opponent') {
          opponentSwingTimeRef.current = 1.0; // Trigger procedural lunge/swing animation
        }
      };
    }
    return () => {
      if (physics) {
        physics.onPaddleHit = null;
      }
    };
  }, [physics, onPaddleHit]);

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

    // Use window dimensions as fallback — containerRef may have 0 size before browser layout
    const width = containerRef.current.clientWidth || window.innerWidth;
    const height = containerRef.current.clientHeight || window.innerHeight;

    // SCENE
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    // CAMERA — Immersive Player POV (Adjusted to bring racket into view)
    const camera = new THREE.PerspectiveCamera(65, width / height, 0.1, 100);
    camera.position.set(0, 0.85 + Y_OFFSET, 2.05);
    camera.lookAt(0, 0.12 + Y_OFFSET, -0.1);
    cameraRef.current = camera;

    // RENDERER — alpha enabled for simulated AR background visibility
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
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

    // Setup GLTF Asset Loader
    const loader = new GLTFLoader();

    // Helper to dynamically load an image and mask out dark black pixels to make them transparent cutouts
    const loadTransparentTexture = (url, callback) => {
      const texLoader = new THREE.TextureLoader();
      texLoader.load(url, (texture) => {
        const img = texture.image;
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);
        
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imgData.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i+1];
          const b = data[i+2];
          // Mask out pure black and very dark gray background pixels
          if (r < 22 && g < 22 && b < 22) {
            data[i+3] = 0; // alpha = 0 (transparent)
          }
        }
        ctx.putImageData(imgData, 0, 0);
        
        const transparentTexture = new THREE.CanvasTexture(canvas);
        transparentTexture.colorSpace = THREE.SRGBColorSpace;
        callback(transparentTexture);
      });
    };

    // LIGHTS
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.22); // Dimmer ambient to keep spectator seating in shadow
    scene.add(ambientLight);

    // 1. Primary Arena Overhead Spotlights (focused on the match table)
    const spotLight1 = new THREE.SpotLight(0xffffff, 4.0, 10, Math.PI / 4.5, 0.8, 1.0);
    spotLight1.position.set(0, 3.6, 1.2);
    spotLight1.target.position.set(0, Y_OFFSET, 0.5);
    spotLight1.castShadow = true;
    spotLight1.shadow.mapSize.width = 1024;
    spotLight1.shadow.mapSize.height = 1024;
    spotLight1.shadow.bias = -0.001;
    scene.add(spotLight1);
    scene.add(spotLight1.target);

    const spotLight2 = new THREE.SpotLight(0xffffff, 4.0, 10, Math.PI / 4.5, 0.8, 1.0);
    spotLight2.position.set(0, 3.6, -1.2);
    spotLight2.target.position.set(0, Y_OFFSET, -0.5);
    spotLight2.castShadow = true;
    spotLight2.shadow.mapSize.width = 1024;
    spotLight2.shadow.mapSize.height = 1024;
    spotLight2.shadow.bias = -0.001;
    scene.add(spotLight2);
    scene.add(spotLight2.target);

    // 2. Volumetric Light Cones (glowing additive cylinders showing light beam shafts)
    const lightConeGeom = new THREE.CylinderGeometry(0.04, 1.0, 3.6, 16, 1, true);
    lightConeGeom.translate(0, -1.8, 0); // align pivot to top base of the cylinder
    lightConeGeom.rotateX(Math.PI / 2);  // rotate so cylinder extends along Z axis

    const lightConeMat = new THREE.MeshBasicMaterial({
      color: 0xe5f2ff, // cool white stadium bulb glow
      transparent: true,
      opacity: 0.08,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false
    });

    const cone1 = new THREE.Mesh(lightConeGeom, lightConeMat);
    cone1.position.set(0, 3.6, 1.2);
    cone1.lookAt(0, Y_OFFSET, 0.5);
    scene.add(cone1);

    const cone2 = new THREE.Mesh(lightConeGeom, lightConeMat);
    cone2.position.set(0, 3.6, -1.2);
    cone2.lookAt(0, Y_OFFSET, -0.5);
    scene.add(cone2);

    // Helper to generate dynamic neon logo textures for surrounds
    const createBarrierTexture = (text) => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 128;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#0e111a';
      ctx.fillRect(0, 0, 512, 128);
      ctx.strokeStyle = '#00f3ff';
      ctx.lineWidth = 5;
      ctx.strokeRect(5, 5, 502, 118);
      ctx.shadowColor = '#00f3ff';
      ctx.shadowBlur = 10;
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 36px Orbitron, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 256, 64);
      const texture = new THREE.CanvasTexture(canvas);
      return texture;
    };

    // Helper to generate dynamic wood grain texture for sports floor
    const createWoodTexture = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 512;
      const ctx = canvas.getContext('2d');
      
      // Warm floor oak base
      ctx.fillStyle = '#d29154';
      ctx.fillRect(0, 0, 512, 512);
      
      // Draw wood plank grids
      ctx.strokeStyle = '#a66a32';
      ctx.lineWidth = 1;
      for (let i = 0; i < 512; i += 32) {
        ctx.beginPath();
        ctx.moveTo(i, 0);
        ctx.lineTo(i, 512);
        ctx.stroke();
        
        // Plank horizontal seams
        for (let j = (i % 64 === 0 ? 0 : 32); j < 512; j += 64) {
          ctx.beginPath();
          ctx.moveTo(i, j);
          ctx.lineTo(i + 32, j);
          ctx.stroke();
        }
      }
      
      // Plank tone variation
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = 'rgba(139, 69, 19, 0.03)';
        ctx.fillRect(Math.floor(Math.random()*16)*32, Math.floor(Math.random()*16)*32, 32, 64);
      }
      
      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(8, 8);
      return texture;
    };

    // 3D ENVIRONMENT (Classic sports gymnasium/arena backdrop)
    if (!isARMode) {
      // Add subtle room depth fog
      scene.fog = new THREE.FogExp2(0x0a1017, 0.035);

      // Deep gymnasium green-blue backdrop
      scene.background = new THREE.Color(0x0a1017);

      // Matte dark wood floor
      const floorGeom = new THREE.PlaneGeometry(40, 40);
      const floorMat = new THREE.MeshStandardMaterial({
        map: createWoodTexture(),
        roughness: 0.28, // lowered roughness to represent high-sheen polished wood
        metalness: 0.15  // catches reflections of overhead spotlights realistically
      });
      const floor = new THREE.Mesh(floorGeom, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.position.y = -0.76 + Y_OFFSET;
      floor.receiveShadow = true;
      scene.add(floor);

      // Court white lines markings (framing the playing zone)
      const boundaryLineGeom = new THREE.BoxGeometry(3.95, 0.002, 4.95);
      const boundaryLineMat = new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.45 });
      const boundaryLines = new THREE.Mesh(boundaryLineGeom, boundaryLineMat);
      boundaryLines.position.set(0, -0.758 + Y_OFFSET, -0.2); // flat on floor
      scene.add(boundaryLines);

      // Overhead gymnasium rectangular fluorescent lighting grids
      const fixtureGeom = new THREE.BoxGeometry(1.6, 0.05, 0.6);
      const fixtureMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      
      const overheadLights = [
        { x: -2.0, z: -1.5 },
        { x: 2.0, z: -1.5 },
        { x: -2.0, z: 1.5 },
        { x: 2.0, z: 1.5 },
        { x: 0, z: 0 }
      ];
      
      overheadLights.forEach(pos => {
        const fixture = new THREE.Mesh(fixtureGeom, fixtureMat);
        fixture.position.set(pos.x, 3.5, pos.z);
        scene.add(fixture);
      });

      // Gymnasium Back Wall (at z = -9.0 to enclose the room and provide dramatic depth feel)
      const wallGeom = new THREE.PlaneGeometry(24, 10);
      const wallMat = new THREE.MeshStandardMaterial({
        color: 0x090f17, // clean matte dark blue-green wall
        roughness: 0.85,
        metalness: 0.1
      });
      const backWall = new THREE.Mesh(wallGeom, wallMat);
      backWall.position.set(0, 5 - 0.76 + Y_OFFSET, -9.0);
      backWall.receiveShadow = true;
      scene.add(backWall);

      // Add 3 large gymnasium windows on the back wall (adds beautiful lighting contrast)
      const windowGeom = new THREE.PlaneGeometry(1.5, 3.2);
      const windowMat = new THREE.MeshStandardMaterial({
        color: 0x001122,
        emissive: 0x6bb8ff, // soft light blue gym window glow
        emissiveIntensity: 0.35,
        roughness: 0.2
      });
      const windowPositions = [-4.0, 0, 4.0];
      windowPositions.forEach(x => {
        const win = new THREE.Mesh(windowGeom, windowMat);
        win.position.set(x, 3.0 + Y_OFFSET, -8.96);
        scene.add(win);
      });

      // Add a couple of horizontal gym wall stripes for realistic detail
      const stripeGeom = new THREE.PlaneGeometry(24, 0.06);
      const stripeMat = new THREE.MeshBasicMaterial({ color: 0x142131, transparent: true, opacity: 0.4 });
      
      const stripe1 = new THREE.Mesh(stripeGeom, stripeMat);
      stripe1.position.set(0, 1.8 + Y_OFFSET, -8.98);
      scene.add(stripe1);

      const stripe2 = new THREE.Mesh(stripeGeom, stripeMat);
      stripe2.position.set(0, 3.4 + Y_OFFSET, -8.98);
      scene.add(stripe2);

      // Spectator Stands / Gallery (Concrete steps behind back barrier)
      const standGeom = new THREE.BoxGeometry(4.2, 0.25, 0.7);
      const standMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, roughness: 0.75 });
      
      const standRow1 = new THREE.Mesh(standGeom, standMat);
      standRow1.position.set(0, 0.125 - 0.76 + Y_OFFSET, -4.5);
      scene.add(standRow1);

      const standRow2 = new THREE.Mesh(standGeom, standMat);
      standRow2.position.set(0, 0.375 - 0.76 + Y_OFFSET, -5.1);
      scene.add(standRow2);

      // Photorealistic Spectator Audience Billboard
      const crowdGeom = new THREE.PlaneGeometry(4.2, 1.4);
      const crowdMat = new THREE.MeshStandardMaterial({
        transparent: true,
        alphaTest: 0.1,
        side: THREE.DoubleSide,
        roughness: 0.7
      });
      const crowdMesh = new THREE.Mesh(crowdGeom, crowdMat);
      crowdMesh.position.set(0, 0.62 - 0.76 + Y_OFFSET, -4.55); // positioned directly on stands
      scene.add(crowdMesh);

      // Load transparent cutout crowd photo
      loadTransparentTexture('/textures/spectators_crowd.png', (texture) => {
        crowdMesh.material.map = texture;
        crowdMesh.material.needsUpdate = true;
      });

      // Hanging Tournament Banners (from the ceiling rafters)
      const bannerGeom = new THREE.PlaneGeometry(0.4, 0.95);
      const bannerMatRed = new THREE.MeshStandardMaterial({ color: 0xa82035, roughness: 0.8, side: THREE.DoubleSide });
      const bannerMatBlue = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.8, side: THREE.DoubleSide });
      const bannerMetalMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8 });

      const bannerPositions = [
        { x: -2.15, z: -3.2, mat: bannerMatRed },
        { x: 2.15, z: -3.2, mat: bannerMatBlue },
        { x: -2.15, z: -0.8, mat: bannerMatBlue },
        { x: 2.15, z: -0.8, mat: bannerMatRed },
        { x: -2.15, z: 1.6, mat: bannerMatRed },
        { x: 2.15, z: 1.6, mat: bannerMatBlue }
      ];

      bannerPositions.forEach((pos) => {
        const flag = new THREE.Mesh(bannerGeom, pos.mat);
        flag.position.set(pos.x, 2.9, pos.z);
        scene.add(flag);

        // Thin hanger pole support
        const flagPole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.44), bannerMetalMat);
        flagPole.rotation.z = Math.PI / 2;
        flagPole.position.set(pos.x, 3.4, pos.z);
        scene.add(flagPole);
      });


      // Helper to generate dynamic white tournament logo texture for red barriers
      const createClassicBarrierTexture = (text) => {
        const canvas = document.createElement('canvas');
        canvas.width = 512;
        canvas.height = 128;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#5a1827';
        ctx.fillRect(0, 0, 512, 128);
        
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4;
        ctx.strokeRect(12, 12, 512 - 24, 128 - 24);
        
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 36px Arial, Helvetica, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, 256, 64);
        
        return new THREE.CanvasTexture(canvas);
      };

      // Helper to generate scrolling LED advertising banner textures
      const createLedTexture = () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1024;
        canvas.height = 64;
        const ctx = canvas.getContext('2d');
        
        ctx.fillStyle = '#060a12';
        ctx.fillRect(0, 0, 1024, 64);
        
        // Draw colorful glowing LED blocks
        const colors = ['#00f3ff', '#ff007f', '#ffd700', '#00ff66'];
        for (let i = 0; i < 1024; i += 256) {
          const color = colors[(i / 256) % colors.length];
          
          // Draw frame decoration
          ctx.strokeStyle = color;
          ctx.lineWidth = 2;
          ctx.strokeRect(i + 10, 8, 236, 48);
          
          // Text glow details
          ctx.fillStyle = color;
          ctx.font = 'bold 24px Arial, Helvetica, sans-serif';
          ctx.shadowColor = color;
          ctx.shadowBlur = 6;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('SHADOW TOUR 2026', i + 128, 32);
          ctx.shadowBlur = 0; // reset
        }
        
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = THREE.RepeatWrapping;
        return texture;
      };

      // Classic matte red tournament surround barriers with white branding decals
      const barrierGeom = new THREE.BoxGeometry(4.0, 0.72, 0.04);
      const backBarrierMat = new THREE.MeshStandardMaterial({
        map: createClassicBarrierTexture('SHADOW TOUR'),
        roughness: 0.65
      });

      // Back barrier behind AI
      const backBarrier = new THREE.Mesh(barrierGeom, backBarrierMat);
      backBarrier.position.set(0, 0.36 - 0.76 + Y_OFFSET, -2.6);
      scene.add(backBarrier);

      // Side barriers left and right
      const sideBarrierGeom = new THREE.BoxGeometry(0.04, 0.72, 4.4);
      const sideBarrierTexture = createClassicBarrierTexture('TABLE TENNIS');
      sideBarrierTexture.wrapS = THREE.RepeatWrapping;
      sideBarrierTexture.repeat.set(1.5, 1);
      const sideBarrierMat = new THREE.MeshStandardMaterial({
        map: sideBarrierTexture,
        roughness: 0.65
      });
      
      const leftBarrier = new THREE.Mesh(sideBarrierGeom, sideBarrierMat);
      leftBarrier.position.set(-2.0, 0.36 - 0.76 + Y_OFFSET, -0.4);
      scene.add(leftBarrier);

      const rightBarrier = new THREE.Mesh(sideBarrierGeom, sideBarrierMat);
      rightBarrier.position.set(2.0, 0.36 - 0.76 + Y_OFFSET, -0.4);
      scene.add(rightBarrier);

      // ── LED ADVERTISING BOARDS (glowing dynamic panels placed on top of red barriers) ──
      const ledTex = createLedTexture();
      const backLedGeom = new THREE.BoxGeometry(4.02, 0.14, 0.05);
      const backLedMat = new THREE.MeshStandardMaterial({
        map: ledTex,
        emissiveMap: ledTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.95,
        roughness: 0.15
      });
      
      const backLedBoard = new THREE.Mesh(backLedGeom, backLedMat);
      backLedBoard.position.set(0, 0.72 + 0.07 - 0.76 + Y_OFFSET, -2.6);
      scene.add(backLedBoard);
      scene._ledTexture = ledTex; // save for loop animation

      // Side LED Boards (left and right)
      const sideLedTex = ledTex.clone();
      sideLedTex.wrapS = THREE.RepeatWrapping;
      const sideLedGeom = new THREE.BoxGeometry(0.05, 0.14, 4.42);
      const sideLedMat = new THREE.MeshStandardMaterial({
        map: sideLedTex,
        emissiveMap: sideLedTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.95,
        roughness: 0.15
      });

      const leftLedBoard = new THREE.Mesh(sideLedGeom, sideLedMat);
      leftLedBoard.position.set(-2.0, 0.72 + 0.07 - 0.76 + Y_OFFSET, -0.4);
      scene.add(leftLedBoard);

      const rightLedBoard = new THREE.Mesh(sideLedGeom, sideLedMat);
      rightLedBoard.position.set(2.0, 0.72 + 0.07 - 0.76 + Y_OFFSET, -0.4);
      scene.add(rightLedBoard);
      scene._sideLedTexture = sideLedTex; // save for loop animation

      // Overhead structural trusses (ceiling rafters grid layout)
      const trussGeomX = new THREE.CylinderGeometry(0.015, 0.015, 6, 8);
      trussGeomX.rotateZ(Math.PI / 2);
      const trussGeomZ = new THREE.CylinderGeometry(0.015, 0.015, 8, 8);
      trussGeomZ.rotateX(Math.PI / 2);
      const trussMat = new THREE.MeshStandardMaterial({ color: 0x1c2430, metalness: 0.6, roughness: 0.4 });

      // Horizontal beams (spanning X)
      for (let zVal of [-3.8, -1.8, 0, 1.8, 3.8]) {
        const beam = new THREE.Mesh(trussGeomX, trussMat);
        beam.position.set(0, 3.6, zVal);
        scene.add(beam);
      }

      // Longitudinal beams (spanning Z)
      for (let xVal of [-2.4, 2.4]) {
        const beam = new THREE.Mesh(trussGeomZ, trussMat);
        beam.position.set(xVal, 3.6, 0);
        scene.add(beam);
      }

      // ── TOURNAMENT PROP DETAILS ──
      const metalMat = new THREE.MeshStandardMaterial({ color: 0x22262f, metalness: 0.8, roughness: 0.2 });
      const fabricMat = new THREE.MeshStandardMaterial({ color: 0x1f4d30, roughness: 0.7 }); // dark green seat padding
      
      // 1. Referee Chair (High stool with steps placed next to the net on the left)
      const refChair = new THREE.Group();
      
      // 4 Leg frames
      const refLegGeom = new THREE.CylinderGeometry(0.008, 0.008, 0.8, 8);
      for (let xOffset of [-0.07, 0.07]) {
        for (let zOffset of [-0.07, 0.07]) {
          const leg = new THREE.Mesh(refLegGeom, metalMat);
          leg.position.set(xOffset, 0.4, zOffset);
          // tilt legs slightly outward for stability
          leg.rotation.z = xOffset * -1.5;
          leg.rotation.x = zOffset * 1.5;
          refChair.add(leg);
        }
      }
      
      // Seat cushion
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.04, 0.18), fabricMat);
      seat.position.y = 0.8;
      refChair.add(seat);
      
      // Backrest
      const backrest = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.02), fabricMat);
      backrest.position.set(0, 0.89, -0.08);
      refChair.add(backrest);

      // Support steps (Ladder)
      const stepGeom = new THREE.BoxGeometry(0.13, 0.012, 0.03);
      for (let stepY of [0.25, 0.45, 0.65]) {
        const step = new THREE.Mesh(stepGeom, metalMat);
        step.position.set(0, stepY, 0.06);
        refChair.add(step);
      }
      
      refChair.position.set(-1.15, -0.76 + Y_OFFSET, 0); // next to net
      refChair.rotation.y = Math.PI / 2; // face the table
      scene.add(refChair);

      // 2. Scoreboard Stand (Live score screen displaying real-time match points)
      const scoreStand = new THREE.Group();
      
      // Base pole
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.65, 12), metalMat);
      pole.position.y = 0.325;
      scoreStand.add(pole);
      
      const poleBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.02, 16), metalMat);
      poleBase.position.y = 0.01;
      scoreStand.add(poleBase);
      
      // Display box housing
      const displayHousing = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.18, 0.03), metalMat);
      displayHousing.position.set(0, 0.65, 0);
      scoreStand.add(displayHousing);
      
      // Scoreboard screen plane
      const scoreCanvas = document.createElement('canvas');
      scoreCanvas.width = 256;
      scoreCanvas.height = 128;
      const scoreTex = new THREE.CanvasTexture(scoreCanvas);
      
      const scoreScreenMat = new THREE.MeshBasicMaterial({ map: scoreTex, side: THREE.DoubleSide });
      const scoreScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.16), scoreScreenMat);
      scoreScreen.position.set(0, 0.65, 0.016); // slightly forward of box
      scoreStand.add(scoreScreen);
      
      scoreStand.position.set(1.15, -0.76 + Y_OFFSET, 0.0);
      scoreStand.rotation.y = -Math.PI / 2; // face the table/players
      scene.add(scoreStand);
      scene._scoreCanvas = scoreCanvas;
      scene._scoreTex = scoreTex; // save ref to redraw score in rendering loop

      // 3. Ball Basket (Wire frame bucket filled with spare orange table tennis balls)
      const basketGroup = new THREE.Group();
      const basketStand = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.45, 8), metalMat);
      basketStand.position.y = 0.225;
      basketGroup.add(basketStand);

      const basketStandBase = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.015, 12), metalMat);
      basketStandBase.position.y = 0.01;
      basketGroup.add(basketStandBase);
      
      // Basket frame
      const basketFrame = new THREE.Mesh(
        new THREE.CylinderGeometry(0.09, 0.07, 0.16, 12, 1, true),
        new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.7, roughness: 0.3, wireframe: true })
      );
      basketFrame.position.y = 0.45 + 0.08;
      basketGroup.add(basketFrame);

      // Add orange balls inside
      const bBallGeom = new THREE.SphereGeometry(0.014, 8, 8);
      const bBallMat = new THREE.MeshStandardMaterial({ color: 0xffaa00, roughness: 0.6 }); // orange balls
      for (let b = 0; b < 6; b++) {
        const spareBall = new THREE.Mesh(bBallGeom, bBallMat);
        spareBall.position.set(
          (Math.random() - 0.5) * 0.08,
          0.45 + 0.04 + Math.random() * 0.06,
          (Math.random() - 0.5) * 0.08
        );
        basketGroup.add(spareBall);
      }
      
      basketGroup.position.set(-1.15, -0.76 + Y_OFFSET, 1.35); // corner
      scene.add(basketGroup);

      // 4. Towel Stand (Steel stand with folded white towel)
      const towelGroup = new THREE.Group();
      
      // Frame U-shape
      const frameL = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 8), metalMat);
      frameL.position.set(-0.08, 0.25, 0);
      towelGroup.add(frameL);

      const frameR = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 8), metalMat);
      frameR.position.set(0.08, 0.25, 0);
      towelGroup.add(frameR);

      const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.17, 8), metalMat);
      crossbar.rotation.z = Math.PI / 2;
      crossbar.position.set(0, 0.5, 0);
      towelGroup.add(crossbar);

      // Folded white towel draped over bar
      const towel = new THREE.Mesh(
        new THREE.BoxGeometry(0.12, 0.18, 0.015),
        new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.9 })
      );
      towel.position.set(0, 0.43, 0);
      towelGroup.add(towel);
      
      towelGroup.position.set(1.15, -0.76 + Y_OFFSET, 1.35);
      towelGroup.rotation.y = -Math.PI / 4;
      scene.add(towelGroup);

      // 5. Water Bottles (Plastic bottles sitting on the floor)
      const bottleGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.065, 8);
      const bottleMat = new THREE.MeshStandardMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.75, roughness: 0.2 }); // blue transparent plastic
      const capMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      
      const bottle = new THREE.Mesh(bottleGeom, bottleMat);
      bottle.position.set(1.05, 0.03 - 0.76 + Y_OFFSET, 1.15);
      
      const bottleCap = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.01, 8), capMat);
      bottleCap.position.set(1.05, 0.065 - 0.76 + Y_OFFSET, 1.15);
      scene.add(bottle);
      scene.add(bottleCap);

      // 6. Floating dust particles under the stadium lights (adds atmospheric depth)
      const dustGeom = new THREE.BufferGeometry();
      const dustCount = 80;
      const dustPositions = new Float32Array(dustCount * 3);
      const dustVelocities = [];

      for (let i = 0; i < dustCount; i++) {
        // Distribute within playing court area cylinder: x = [-2.0, 2.0], y = [-0.76, 3.5], z = [-2.5, 2.5]
        dustPositions[i * 3] = (Math.random() - 0.5) * 4.0;
        dustPositions[i * 3 + 1] = Math.random() * 4.2 - 0.76 + Y_OFFSET;
        dustPositions[i * 3 + 2] = (Math.random() - 0.5) * 5.0;
        
        // Slow downward drift with tiny drift sways
        dustVelocities.push({
          x: (Math.random() - 0.5) * 0.04,
          y: -Math.random() * 0.03 - 0.015,
          z: (Math.random() - 0.5) * 0.04
        });
      }

      dustGeom.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));

      // Circular blurred point texture for particles
      const dustCanvas = document.createElement('canvas');
      dustCanvas.width = 16;
      dustCanvas.height = 16;
      const dustCtx = dustCanvas.getContext('2d');
      const grad = dustCtx.createRadialGradient(8, 8, 0, 8, 8, 8);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.45)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0.0)');
      dustCtx.fillStyle = grad;
      dustCtx.fillRect(0, 0, 16, 16);

      const dustTex = new THREE.CanvasTexture(dustCanvas);
      const dustMat = new THREE.PointsMaterial({
        size: 0.022,
        map: dustTex,
        transparent: true,
        opacity: 0.5,
        blending: THREE.AdditiveBlending,
        depthWrite: false
      });

      const dustParticles = new THREE.Points(dustGeom, dustMat);
      scene.add(dustParticles);
      scene._dustPositions = dustPositions;
      scene._dustVelocities = dustVelocities;
      scene._dustGeom = dustGeom;
    } else {
      scene.background = null; // transparent background for AR overlay
    }

    // TABLE
    // Dimensions: x = 1.525, y = 0.04, z = 2.74
    const proceduralTableGroup = new THREE.Group();
    proceduralTableGroup.name = "proceduralTable";

    const tableGeom = new THREE.BoxGeometry(1.525, 0.04, 2.74);
    const tableMat = new THREE.MeshStandardMaterial({
      color: 0x143c2c, // Classic Olympic matte forest green table
      roughness: 0.70, // Matte texture (less glare)
      metalness: 0.15,
      side: THREE.DoubleSide
    });
    const tableMesh = new THREE.Mesh(tableGeom, tableMat);
    tableMesh.position.y = -0.02 + Y_OFFSET;
    tableMesh.receiveShadow = true;
    proceduralTableGroup.add(tableMesh);

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

    proceduralTableGroup.add(linesGroup);

    // Table Legs (4 sturdy steel posts)
    const legGeom = new THREE.CylinderGeometry(0.025, 0.025, 0.76 + Y_OFFSET);
    const legMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, metalness: 0.5, roughness: 0.4 });
    const legs = [
      { x: -0.7, z: -1.3 },
      { x: 0.7, z: -1.3 },
      { x: -0.7, z: 1.3 },
      { x: 0.7, z: 1.3 }
    ];
    legs.forEach(pos => {
      const leg = new THREE.Mesh(legGeom, legMat);
      leg.position.set(pos.x, -(0.76 + Y_OFFSET) / 2 + Y_OFFSET, pos.z);
      proceduralTableGroup.add(leg);
    });

    scene.add(proceduralTableGroup);

    // Try loading custom 3D table model
    loader.load('/models/table.glb', (gltf) => {
      const customTable = gltf.scene;
      customTable.position.set(0, Y_OFFSET, 0);
      customTable.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(customTable);
      proceduralTableGroup.visible = false;
      console.log('[Asset Loader] Loaded custom table.glb model successfully.');
    }, undefined, (err) => {
      console.log('[Asset Loader] Custom table.glb not found or error. Using procedural table.');
    });

    // NET
    // Dimensions: Height = 0.1525, Width = TABLE_WIDTH + 0.15 (1.525 + 0.15)
    const proceduralNetGroup = new THREE.Group();
    proceduralNetGroup.name = "proceduralNet";

    const netWidth = 1.525 + 0.15;
    // Segmented plane geometry to allow realistic sag deformations
    const netGeom = new THREE.PlaneGeometry(netWidth, 0.1525, 12, 1);
    
    // Apply parabolic sag to net vertices (greatest deflection at center x=0)
    const posAttr = netGeom.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      const distFromCenter = Math.abs(x) / (netWidth / 2);
      const sagFactor = 1 - distFromCenter * distFromCenter; // 1 at center, 0 at posts
      const sag = 0.015 * sagFactor; // sag by 1.5 cm in the middle
      posAttr.setY(i, y - sag);
    }
    netGeom.computeVertexNormals();

    // Grid pattern net texture (Classic black mesh)
    const netCanvas = document.createElement('canvas');
    netCanvas.width = 64;
    netCanvas.height = 64;
    const netCtx = netCanvas.getContext('2d');
    netCtx.fillStyle = 'rgba(20, 20, 20, 0.82)'; // Charcoal black base
    netCtx.fillRect(0, 0, 64, 64);
    netCtx.strokeStyle = '#ffffff'; // White netting mesh cords
    netCtx.lineWidth = 1;
    netCtx.strokeRect(0, 0, 64, 64);
    netCtx.beginPath();
    netCtx.moveTo(0, 16); netCtx.lineTo(64, 16);
    netCtx.moveTo(0, 32); netCtx.lineTo(64, 32);
    netCtx.moveTo(0, 48); netCtx.lineTo(64, 48);
    netCtx.moveTo(16, 0); netCtx.lineTo(16, 64);
    netCtx.moveTo(32, 0); netCtx.lineTo(32, 64);
    netCtx.moveTo(48, 0); netCtx.lineTo(48, 64);
    netCtx.stroke();

    const netTexture = new THREE.CanvasTexture(netCanvas);
    netTexture.wrapS = THREE.RepeatWrapping;
    netTexture.wrapT = THREE.RepeatWrapping;
    netTexture.repeat.set(22, 2);

    const netMat = new THREE.MeshStandardMaterial({
      map: netTexture,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const netMesh = new THREE.Mesh(netGeom, netMat);
    netMesh.position.set(0, 0.1525 / 2 + Y_OFFSET, 0);
    proceduralNetGroup.add(netMesh);

    // Net top strip (White tournament tape - also sags along with the net)
    const topStripGeom = new THREE.PlaneGeometry(netWidth, 0.014, 12, 1);
    const posAttrTop = topStripGeom.attributes.position;
    for (let i = 0; i < posAttrTop.count; i++) {
      const x = posAttrTop.getX(i);
      const y = posAttrTop.getY(i);
      const distFromCenter = Math.abs(x) / (netWidth / 2);
      const sagFactor = 1 - distFromCenter * distFromCenter;
      const sag = 0.015 * sagFactor;
      posAttrTop.setY(i, y - sag);
    }
    topStripGeom.computeVertexNormals();

    const topStripMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const topStrip = new THREE.Mesh(topStripGeom, topStripMat);
    topStrip.position.set(0, 0.1525 + Y_OFFSET - 0.007, 0);
    proceduralNetGroup.add(topStrip);

    // Net support posts (Brackets) on sides
    const postGeom = new THREE.CylinderGeometry(0.01, 0.01, 0.18, 16);
    const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2b2b, metalness: 0.8, roughness: 0.2 });
    
    const leftPost = new THREE.Mesh(postGeom, postMat);
    leftPost.position.set(-netWidth / 2, 0.18 / 2 + Y_OFFSET - 0.013, 0);
    proceduralNetGroup.add(leftPost);
    
    const rightPost = new THREE.Mesh(postGeom, postMat);
    rightPost.position.set(netWidth / 2, 0.18 / 2 + Y_OFFSET - 0.013, 0);
    proceduralNetGroup.add(rightPost);

    scene.add(proceduralNetGroup);

    // Try loading custom 3D net model
    loader.load('/models/net.glb', (gltf) => {
      const customNet = gltf.scene;
      customNet.position.set(0, Y_OFFSET, 0);
      customNet.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      scene.add(customNet);
      proceduralNetGroup.visible = false;
      console.log('[Asset Loader] Loaded custom net.glb model successfully.');
    }, undefined, (err) => {
      console.log('[Asset Loader] Custom net.glb not found or error. Using procedural net.');
    });

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

    // PADDLES (Classic Red & Black rubber faces with wooden cores)
    // Dimensions: Radius = 0.1 (diameter = 0.2), Thickness = 0.008
    const bladeCoreGeom = new THREE.CylinderGeometry(0.1, 0.1, 0.008, 32);
    bladeCoreGeom.rotateX(Math.PI / 2); // orient circular face towards net
    const woodCoreMat = new THREE.MeshStandardMaterial({ color: 0xe5c19d, roughness: 0.6 }); // light wood edge plywood

    // Rubbers (Thin disks attached to the blade faces)
    const rubberDiskGeom = new THREE.CylinderGeometry(0.098, 0.098, 0.002, 32);
    rubberDiskGeom.rotateX(Math.PI / 2);
    const redRubberMat = new THREE.MeshStandardMaterial({ color: 0xc8102e, roughness: 0.75, metalness: 0.1 }); // Tournament red
    const blackRubberMat = new THREE.MeshStandardMaterial({ color: 0x161616, roughness: 0.75, metalness: 0.1 }); // Tournament black

    // Wooden handle stubs
    const handleGeom = new THREE.CylinderGeometry(0.015, 0.015, 0.11, 16);
    const woodHandleMat = new THREE.MeshStandardMaterial({ color: 0xa67c52, roughness: 0.5 }); // Dark wood handle

    // Player Paddle (Red face toward camera, Black face on backside)
    const playerPaddleMesh = new THREE.Group();
    
    const playerPaddleBlade = new THREE.Mesh(bladeCoreGeom, woodCoreMat);
    playerPaddleBlade.castShadow = true;
    playerPaddleMesh.add(playerPaddleBlade);

    const playerRedRubber = new THREE.Mesh(rubberDiskGeom, redRubberMat);
    playerRedRubber.position.z = 0.005; // front face
    playerPaddleMesh.add(playerRedRubber);

    const playerBlackRubber = new THREE.Mesh(rubberDiskGeom, blackRubberMat);
    playerBlackRubber.position.z = -0.005; // back face
    playerPaddleMesh.add(playerBlackRubber);
    
    const playerPaddleHandle = new THREE.Mesh(handleGeom, woodHandleMat);
    playerPaddleHandle.position.set(0, -0.14, 0);
    playerPaddleMesh.add(playerPaddleHandle);
    
    scene.add(playerPaddleMesh);
    playerPaddleMeshRef.current = playerPaddleMesh;

    // Opponent Paddle (Red face toward player camera, Black face on backside)
    const opponentPaddleMesh = new THREE.Group();
    
    const opponentPaddleBlade = new THREE.Mesh(bladeCoreGeom, woodCoreMat);
    opponentPaddleBlade.castShadow = true;
    opponentPaddleMesh.add(opponentPaddleBlade);

    const opponentRedRubber = new THREE.Mesh(rubberDiskGeom, redRubberMat);
    opponentRedRubber.position.z = 0.005; // front face facing player
    opponentPaddleMesh.add(opponentRedRubber);

    const opponentBlackRubber = new THREE.Mesh(rubberDiskGeom, blackRubberMat);
    opponentBlackRubber.position.z = -0.005; // back face
    opponentPaddleMesh.add(opponentBlackRubber);
    
    const opponentPaddleHandle = new THREE.Mesh(handleGeom, woodHandleMat);
    opponentPaddleHandle.position.set(0, -0.14, 0);
    opponentPaddleMesh.add(opponentPaddleHandle);

    scene.add(opponentPaddleMesh);
    opponentPaddleMeshRef.current = opponentPaddleMesh;

    // Try loading custom 3D racket model
    loader.load('/models/racket.glb', (gltf) => {
      // Custom Player Racket mesh
      const customPlayerRacket = gltf.scene;
      customPlayerRacket.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      playerPaddleMesh.add(customPlayerRacket);
      playerPaddleBlade.visible = false;
      playerPaddleHandle.visible = false;
      playerRedRubber.visible = false;
      playerBlackRubber.visible = false;

      // Custom Opponent Racket mesh
      const customOpponentRacket = customPlayerRacket.clone();
      opponentPaddleMesh.add(customOpponentRacket);
      opponentPaddleBlade.visible = false;
      opponentPaddleHandle.visible = false;
      opponentRedRubber.visible = false;
      opponentBlackRubber.visible = false;

      console.log('[Asset Loader] Loaded and configured custom racket.glb models successfully.');
    }, undefined, (err) => {
      console.log('[Asset Loader] Custom racket.glb not found or error. Using procedural paddles.');
    });

    // Realistic Detailed 3D Human Opponent Avatar (Classic Tournament Sports Coach)
    if (!isARMode) {
      const opponentAvatar = new THREE.Group();

      // Materials
      const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0a97c, roughness: 0.65 }); // natural skin
      const hairMat = new THREE.MeshStandardMaterial({ color: 0x1f1a17, roughness: 0.85 }); // dark hair
      const jerseyMat = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.75 }); // blue jersey
      const pantsMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.8 }); // dark shorts
      const shoeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }); // white sneakers
      const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

      // Character Group
      const charGroup = new THREE.Group();

      // Hips / Pelvis
      const hips = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 16), pantsMat);
      hips.position.y = -0.15;
      charGroup.add(hips);

      // Torso
      const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.11, 0.40, 16), jerseyMat);
      torso.position.y = 0.09;
      charGroup.add(torso);

      // Neck
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.08, 16), skinMat);
      neck.position.y = 0.31;
      charGroup.add(neck);

      // Head
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 32, 32), skinMat);
      head.position.y = 0.44;
      charGroup.add(head);

      // Eyes (Detailed)
      const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), eyeMat);
      eyeL.position.set(-0.035, 0.46, 0.09);
      const pupilL = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), pupilMat);
      pupilL.position.set(-0.035, 0.46, 0.102);
      charGroup.add(eyeL);
      charGroup.add(pupilL);

      const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 8), eyeMat);
      eyeR.position.set(0.035, 0.46, 0.09);
      const pupilR = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), pupilMat);
      pupilR.position.set(0.035, 0.46, 0.102);
      charGroup.add(eyeR);
      charGroup.add(pupilR);

      // Nose
      const nose = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.035, 4), skinMat);
      nose.rotateX(-Math.PI / 6);
      nose.position.set(0, 0.42, 0.105);
      charGroup.add(nose);

      // Ears
      const earL = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), skinMat);
      earL.position.set(-0.115, 0.44, -0.01);
      charGroup.add(earL);
      const earR = new THREE.Mesh(new THREE.SphereGeometry(0.02, 8, 8), skinMat);
      earR.position.set(0.115, 0.44, -0.01);
      charGroup.add(earR);

      // Hair Cut
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.114, 16, 16, 0, Math.PI * 2, 0, Math.PI / 1.7), hairMat);
      hair.position.set(0, 0.47, -0.015);
      hair.rotation.x = -0.15;
      charGroup.add(hair);

      // Left Leg (standing on wood floor)
      const thighGeom = new THREE.CylinderGeometry(0.045, 0.035, 0.32, 12);
      const shinGeom = new THREE.CylinderGeometry(0.035, 0.025, 0.35, 12);
      const jointGeom = new THREE.SphereGeometry(0.035, 12, 12);

      const leftThigh = new THREE.Mesh(thighGeom, skinMat);
      leftThigh.position.set(-0.08, -0.32, 0);
      charGroup.add(leftThigh);

      const leftKnee = new THREE.Mesh(jointGeom, skinMat);
      leftKnee.position.set(-0.08, -0.48, 0);
      charGroup.add(leftKnee);

      const leftShin = new THREE.Mesh(shinGeom, skinMat);
      leftShin.position.set(-0.08, -0.66, 0);
      charGroup.add(leftShin);

      const leftShoe = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.05, 0.14), shoeMat);
      leftShoe.position.set(-0.08, -0.81, 0.04);
      charGroup.add(leftShoe);

      // Right Leg (standing on wood floor)
      const rightThigh = new THREE.Mesh(thighGeom, skinMat);
      rightThigh.position.set(0.08, -0.32, 0);
      charGroup.add(rightThigh);

      const rightKnee = new THREE.Mesh(jointGeom, skinMat);
      rightKnee.position.set(0.08, -0.48, 0);
      charGroup.add(rightKnee);

      const rightShin = new THREE.Mesh(shinGeom, skinMat);
      rightShin.position.set(0.08, -0.66, 0);
      charGroup.add(rightShin);

      const rightShoe = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.05, 0.14), shoeMat);
      rightShoe.position.set(0.08, -0.81, 0.04);
      charGroup.add(rightShoe);

      // Left Arm (bent in tournament ready posture)
      const sleeveL = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 12), jerseyMat);
      sleeveL.position.set(-0.17, 0.23, 0.03);
      sleeveL.rotation.set(0.3, 0, 0.1);
      charGroup.add(sleeveL);

      const upperArmL = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.16, 12), skinMat);
      upperArmL.position.set(-0.20, 0.14, 0.05);
      upperArmL.rotation.set(0.5, 0, 0.2);
      charGroup.add(upperArmL);

      const elbowL = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), skinMat);
      elbowL.position.set(-0.23, 0.07, 0.08);
      charGroup.add(elbowL);

      const forearmL = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.18, 12), skinMat);
      forearmL.position.set(-0.22, 0.08, 0.16);
      forearmL.rotation.set(1.4, 0.3, 0.3);
      charGroup.add(forearmL);

      const handL = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), skinMat);
      handL.position.set(-0.18, 0.10, 0.24);
      charGroup.add(handL);

      // Right Arm (reaches out to hold the paddle handle dynamically)
      const sleeveR = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.09, 12), jerseyMat);
      sleeveR.position.set(0.17, 0.23, 0.03);
      sleeveR.rotation.set(0.3, 0, -0.1);
      charGroup.add(sleeveR);

      const upperArmR = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.028, 0.16, 12), skinMat);
      upperArmR.position.set(0.20, 0.14, 0.05);
      upperArmR.rotation.set(0.5, 0, -0.2);
      charGroup.add(upperArmR);

      const elbowR = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), skinMat);
      elbowR.position.set(0.23, 0.07, 0.08);
      charGroup.add(elbowR);

      const forearmR = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.022, 0.18, 12), skinMat);
      forearmR.position.set(0.20, 0.09, 0.16);
      forearmR.rotation.set(1.4, -0.3, -0.3);
      charGroup.add(forearmR);

      const handR = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 8), skinMat);
      handR.position.set(0.15, 0.11, 0.24);
      charGroup.add(handR);

      // Make all meshes cast/receive shadows
      charGroup.traverse((node) => {
        if (node.isMesh) {
          node.castShadow = true;
          node.receiveShadow = true;
        }
      });

      opponentAvatar.add(charGroup);

      opponentAvatar.position.set(0, Y_OFFSET, -1.5);
      scene.add(opponentAvatar);
      opponentAvatarRef.current = opponentAvatar;
    }

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

      // Update Player Paddle position from mouse or gyro controller
      const playerPaddleMesh = playerPaddleMeshRef.current;
      if (playerPaddleMesh) {
        let targetX = mouseRef.current.x * 0.95;
        let targetY = THREE.MathUtils.clamp(0.28 + mouseRef.current.y * 0.25, 0.05, 0.55);
        let targetZ = 1.35;

        const controllerActive = isPhoneControllerActiveRef.current;
        const controllerData = phoneControllerDataRef.current;

        if (controllerActive && controllerData) {
          // Attenuate sensitivities to prevent "too fast" movements and filter jitter
          const sensitivityX = 0.020;
          const sensitivityZ = 0.008;
          const sensitivityY = 0.006;

          const smoothTiltZ = controllerData.tiltZ || 0;
          const smoothTiltX = controllerData.tiltX || 0;

          // X is Left/Right (mapped to roll tiltZ)
          targetX = THREE.MathUtils.clamp(smoothTiltZ * sensitivityX, -1.0, 1.0);
          
          // Z is Front/Back (mapped to pitch tiltX; tilt forward/down reduces targetZ closer to net)
          targetZ = THREE.MathUtils.clamp(1.35 + smoothTiltX * sensitivityZ, 1.05, 1.65);

          // Y is Up/Down (mapped to pitch tiltX; tilt backward/up raises paddle)
          targetY = THREE.MathUtils.clamp(0.20 + smoothTiltX * sensitivityY, 0.05, 0.45);

          // Handle serving on mobile tap or swing
          if (gameState === 'serve_player') {
            const hasTapped = controllerData.tapServed && !lastTapServedRef.current;
            const hasSwung = controllerData.accelMag && controllerData.accelMag > 12.0;
            if (hasTapped || hasSwung) {
              physics.serveBall('player');
            }
          }
          lastTapServedRef.current = !!controllerData.tapServed;

          // Track swing acceleration magnitude to scale hit speed
          if (controllerData.accelMag && controllerData.accelMag > 6.0) {
            playerPaddlePosRef.current.swingSpeed = controllerData.accelMag;
          } else {
            playerPaddlePosRef.current.swingSpeed = (playerPaddlePosRef.current.swingSpeed || 0) * 0.85;
          }
          playerPaddlePosRef.current.spinType = controllerData.spinType || 'flat';
        } else {
          playerPaddlePosRef.current.spinType = 'flat';
        }

        // Calculate paddle velocity
        const prevX = playerPaddlePosRef.current.x;
        const prevY = playerPaddlePosRef.current.y;
        const prevZ = playerPaddlePosRef.current.z;

        // Linear interpolation for smooth paddle movement (using 0.58 coefficient for high-speed, lag-free tracking)
        playerPaddlePosRef.current.x += (targetX - prevX) * 0.58;
        playerPaddlePosRef.current.y += (targetY - prevY) * 0.58;
        playerPaddlePosRef.current.z += (targetZ - prevZ) * 0.58;

        // Calculate velocity vector and clamp to prevent extreme physics impulses on sudden jumps
        playerPaddlePosRef.current.vx = THREE.MathUtils.clamp((playerPaddlePosRef.current.x - prevX) / dt, -15, 15);
        playerPaddlePosRef.current.vy = THREE.MathUtils.clamp((playerPaddlePosRef.current.y - prevY) / dt, -15, 15);
        playerPaddlePosRef.current.vz = THREE.MathUtils.clamp((playerPaddlePosRef.current.z - prevZ) / dt, -15, 15);

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
        
        if (controllerActive && controllerData) {
          // Sync exact 3D orientation of the racket mesh with the phone's physical rotation
          const radX = (controllerData.tiltX || 0) * Math.PI / 180;
          const radY = (controllerData.tiltY || 0) * Math.PI / 180;
          const radZ = (controllerData.tiltZ || 0) * Math.PI / 180;

          // Apply rotation with a snappy 0.55 interpolation factor to avoid laggy turns
          playerPaddleMesh.rotation.z += (-radZ + rotationSwayZ - playerPaddleMesh.rotation.z) * 0.55; // Roll
          playerPaddleMesh.rotation.x += (radX + rotationSwayX - playerPaddleMesh.rotation.x) * 0.55;  // Pitch
          playerPaddleMesh.rotation.y += (-radY - playerPaddleMesh.rotation.y) * 0.55; // Yaw
        } else if (isHandTracking) {
          playerPaddleMesh.rotation.z = mouseRef.current.tiltZ + rotationSwayZ;
          playerPaddleMesh.rotation.x = mouseRef.current.tiltX + rotationSwayX;
          playerPaddleMesh.rotation.y = 0;
        } else {
          // Fallback to velocity-based tilt for mouse/touch controls
          playerPaddleMesh.rotation.z = -playerPaddlePosRef.current.vx * 0.04 + rotationSwayZ;
          playerPaddleMesh.rotation.x = playerPaddlePosRef.current.vy * 0.03 + rotationSwayX;
          playerPaddleMesh.rotation.y = 0;
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
            const isMissing = physics.aiErrorType === 'miss';
            const offsetMultiplier = isMissing ? 0.32 : 0;
            const targetOffset = isMissing ? (ball.x > 0 ? -offsetMultiplier : offsetMultiplier) : 0;

            // Predict where the ball is landing on the AI's baseline
            const timeToAI = (targetZ - ball.z) / ball.vz;
            let predX = ball.x;
            if (timeToAI > 0) {
              predX = ball.x + ball.vx * timeToAI + targetOffset;
            }

            // Detect if the shot is going wide / out of bounds (beyond court boundaries x = ±0.80)
            // Only ignore when the ball is close enough for a highly reliable trajectory prediction (timeToAI < 0.7 seconds)
            const isGoingOut = Math.abs(predX) > 0.80;
            const shouldIgnore = isGoingOut && (timeToAI < 0.7) && !physics.aiDecidesToChaseOut;

            if (shouldIgnore) {
              // Ignore wide out-of-bounds shot and stand still/return to center
              opponentPaddlePosRef.current.x += (0 - opponentPaddlePosRef.current.x) * 0.05;
              opponentPaddlePosRef.current.y += (0.15 - opponentPaddlePosRef.current.y) * 0.05;
            } else if (ball.z <= -1.15) {
              // Intercept phase: snap paddle close to ball to guarantee clean contact (with offset if missing)
              let precision = 0.95;
              if (diff === 'pro') {
                precision = 0.92; // fast but beatable on extremely sharp angles / fast smashes
              } else if (diff === 'medium') {
                precision = 0.82; // beatable
              } else if (diff === 'easy') {
                precision = 0.65; // very easy to beat
              } else {
                precision = 0.75;
              }
              opponentPaddlePosRef.current.x += (ball.x + targetOffset - opponentPaddlePosRef.current.x) * precision;
              opponentPaddlePosRef.current.y += (ball.y + targetOffset - opponentPaddlePosRef.current.y) * precision;
            } else {
              if (timeToAI > 0) {
                // Predict X coordinate intersection
                predX = THREE.MathUtils.clamp(predX, -0.75, 0.75);

                // Predict Y coordinate (account for height)
                let predY = ball.y + (isMissing ? targetOffset : 0);
                if (ball.y <= 0) predY = 0.12;
                predY = THREE.MathUtils.clamp(predY + 0.08, 0.05, 0.45);

                // Apply tracking speed and precision offsets depending on difficulty
                let chaseFactor = 0.14;
                if (diff === 'pro') {
                  chaseFactor = 0.21; // highly responsive, but humanly beatable
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

          // Restrict the AI opponent's maximum range of motion so it never moves too far off-court/out-of-range
          opponentPaddlePosRef.current.x = THREE.MathUtils.clamp(opponentPaddlePosRef.current.x, -0.85, 0.85);
          opponentPaddlePosRef.current.y = THREE.MathUtils.clamp(opponentPaddlePosRef.current.y, 0.05, 0.50);

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

      // Update Opponent Avatar position and handle dynamic hit animations (twist & lunge)
      if (opponentAvatarRef.current) {
        // Decay swing timer (swift 150ms total animation duration)
        if (opponentSwingTimeRef.current > 0) {
          opponentSwingTimeRef.current -= dt * 6.5;
          if (opponentSwingTimeRef.current < 0) {
            opponentSwingTimeRef.current = 0;
          }
        }

        const swingT = opponentSwingTimeRef.current;
        // Smooth sine bounce for swing tilt and forward z-lunge
        const swingTiltX = Math.sin(swingT * Math.PI) * 0.38;  // Tilt forward 22 degrees
        const swingLungeZ = Math.sin(swingT * Math.PI) * 0.16;  // Lunge forward 16cm
        
        // Dynamic lateral swing twist depending on velocity direction
        const twistDirection = opponentPaddlePosRef.current.vx > 0 ? 1 : -1;
        const swingTwistY = Math.sin(swingT * Math.PI) * 0.18 * twistDirection;

        opponentAvatarRef.current.position.x = opponentPaddlePosRef.current.x;
        opponentAvatarRef.current.position.z = opponentPaddlePosRef.current.z - 0.15 + swingLungeZ;
        
        // Apply procedural rotation animations to the 2D billboard card for depth feel
        opponentAvatarRef.current.rotation.x = swingTiltX;
        opponentAvatarRef.current.rotation.y = swingTwistY;
      }

      // Update LED advertising board animation scrolling and live scoreboard screen
      if (scene && !isARMode) {
        if (scene._ledTexture) {
          scene._ledTexture.offset.x -= 0.15 * dt;
        }
        if (scene._sideLedTexture) {
          scene._sideLedTexture.offset.x -= 0.15 * dt;
        }
        
        // Dynamic scoreboard screen renderer (updates live score values)
        if (scene._scoreCanvas && scene._scoreTex) {
          const sCanvas = scene._scoreCanvas;
          const ctx = sCanvas.getContext('2d');
          ctx.fillStyle = '#060a13';
          ctx.fillRect(0, 0, 256, 128);
          
          ctx.fillStyle = '#111827';
          ctx.fillRect(10, 36, 110, 75);
          ctx.fillRect(136, 36, 110, 75);
          
          ctx.strokeStyle = '#374151';
          ctx.lineWidth = 2;
          ctx.strokeRect(10, 36, 110, 75);
          ctx.strokeRect(136, 36, 110, 75);
          
          ctx.fillStyle = '#9ca3af';
          ctx.font = 'bold 13px Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('PLAYER', 65, 20);
          ctx.fillText('OPPONENT', 191, 20);
          
          ctx.fillStyle = '#10b981';
          ctx.font = 'bold 50px Courier New, monospace';
          ctx.fillText(physics.score.player.toString(), 65, 73);
          ctx.fillStyle = '#ef4444';
          ctx.fillText(physics.score.opponent.toString(), 191, 73);
          
          scene._scoreTex.needsUpdate = true;
        }

        // Update drifting dust particles under stadium spotlights
        if (scene._dustPositions && scene._dustVelocities && scene._dustGeom) {
          const posAttr = scene._dustGeom.attributes.position;
          const count = posAttr.count;
          for (let i = 0; i < count; i++) {
            let px = posAttr.getX(i) + scene._dustVelocities[i].x * dt;
            let py = posAttr.getY(i) + scene._dustVelocities[i].y * dt;
            let pz = posAttr.getZ(i) + scene._dustVelocities[i].z * dt;
            
            // Loop boundaries back to ceiling height
            if (py < -0.76 + Y_OFFSET) {
              py = 3.5;
            }
            if (Math.abs(px) > 2.0) {
              px = -px;
            }
            if (Math.abs(pz) > 2.5) {
              pz = -pz;
            }
            
            posAttr.setXYZ(i, px, py, pz);
          }
          posAttr.needsUpdate = true;
        }
      }

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

  // 5. MediaPipe Hands Camera tracking with script loading retry mechanism
  useEffect(() => {
    if (!isHandTracking || !webcamElement) return;

    const videoElement = webcamElement;
    let cameraInstance = null;
    let hands = null;
    let active = true;

    const initHands = () => {
      if (!active) return;

      // Check if MediaPipe scripts are loaded
      if (typeof window.Hands === 'undefined' || typeof window.Camera === 'undefined') {
        console.warn("MediaPipe Hands or Camera scripts not loaded yet. Retrying in 500ms...");
        setTimeout(initHands, 500);
        return;
      }

      try {
        hands = new window.Hands({
          locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 0, // Lite model for faster processing and lower CPU usage
          minDetectionConfidence: 0.6,
          minTrackingConfidence: 0.6
        });

        let lastHandTime = performance.now();
        let lastHandX = 0.5;
        let lastHandY = 0.5;

        hands.onResults((results) => {
          if (!active) return;
          if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            const landmarks = results.multiHandLandmarks[0];
            // Landmark 9 is the center of the palm
            const palmCenter = landmarks[9];
            
            // Map camera coordinates (0..1) to normalized mouse coordinate space (-1..1)
            const rawX = (1.0 - palmCenter.x) * 2.0 - 1.0;
            const rawY = (1.0 - palmCenter.y) * 2.0 - 1.0;

            // Target coordinates with wider mapping range
            const targetMouseX = rawX * 1.6;
            const targetMouseY = rawY * 1.6;

            // Low-pass exponential smoothing filter (0.3 coefficient) for snappier tracking response
            if (isNaN(mouseRef.current.x)) mouseRef.current.x = 0;
            if (isNaN(mouseRef.current.y)) mouseRef.current.y = 0.15;

            mouseRef.current.x += (targetMouseX - mouseRef.current.x) * 0.3;
            mouseRef.current.y += (targetMouseY - mouseRef.current.y) * 0.3; 

            // Calculate hand tilt angles
            const p5 = landmarks[5];
            const p17 = landmarks[17];
            let roll = Math.atan2(p17.y - p5.y, p17.x - p5.x);
            
            if (roll > Math.PI / 2) roll -= Math.PI;
            if (roll < -Math.PI / 2) roll += Math.PI;
            const targetTiltZ = -roll * 1.3;

            // Pitch: compare middle finger tip (12) and middle finger knuckle (9)
            const p9 = landmarks[9];
            const p12 = landmarks[12];
            const fingerLengthY = p12.y - p9.y;
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
              const rawSpeed = distHand / dtHand;

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
            if (!active) {
              stream.getTracks().forEach(track => track.stop());
              return;
            }
            videoElement.srcObject = stream;
            
            let isProcessing = false;
            let lastProcessTime = 0;
            const processInterval = 50; // Max 20 FPS (every 50ms) to prevent main thread lag

            cameraInstance = new window.Camera(videoElement, {
              onFrame: async () => {
                if (!isHandTracking || !active) return;
                
                const now = performance.now();
                // Concurrency lock + rate limiter to avoid overloading CPU/GPU
                if (isProcessing || (now - lastProcessTime < processInterval)) {
                  return;
                }

                isProcessing = true;
                lastProcessTime = now;
                try {
                  await hands.send({ image: videoElement });
                } catch (e) {
                  // ignore
                } finally {
                  isProcessing = false;
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

      } catch (e) {
        console.error("Error during MediaPipe hands initialization:", e);
      }
    };

    initHands();

    return () => {
      active = false;
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
      if (hands) {
        try {
          hands.close();
        } catch (e) {}
      }
    };
  }, [isHandTracking, webcamElement]);

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
