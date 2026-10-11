# 🏓 Hyperspace Ping Pong — Premium 3D Table Tennis

[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=black)](https://react.dev/)
[![Three.js](https://img.shields.io/badge/Three.js-3D%20Engine-black?style=flat-square&logo=three.js)](https://threejs.org/)
[![Socket.IO](https://img.shields.io/badge/Socket.IO-Realtime-010101?style=flat-square&logo=socket.io)](https://socket.io/)
[![Vite](https://img.shields.io/badge/Vite-Build%20Tool-646cff?style=flat-square&logo=vite)](https://vitejs.dev/)
[![License](https://img.shields.io/badge/License-MIT-green?style=flat-square)](LICENSE)

An immersive, futuristic 3D table tennis experience in the browser. Play against intelligent AI, challenge opponents online in real-time, or swing your actual smartphone as a physical racket using device gyroscope motion sensing.

🎮 **[Play Live Demo](https://saifuddinm23.github.io/table-tennis)**

---

## ✨ Key Features

- **Realistic 3D Physics Engine**: Custom-built table tennis physics with aerodynamic drag, topspin, backspin, sidespin, and paddle surface friction.
- **📱 Smartphone Motion Controller**: Turn your phone into a handheld table tennis bat! Pairs with your desktop display over WebSockets using your device's gyroscope and accelerometer.
- **🖐️ Webcam Hand Tracking**: Play completely hands-free using MediaPipe Hands computer vision tracking right through your webcam.
- **🌐 Real-Time Multiplayer**: Challenge other players online using Socket.IO room-based matchmaking with synchronized ball and paddle trajectories.
- **🎙️ Voice Command Integration**: Issue hands-free voice commands to serve the ball, pause the game, reset rallies, and adjust settings.
- **🤖 AI Coach & Match Analytics**:
  - Detailed shot placement heatmap overlay on the table
  - Real-time shot speed tracking and longest rally counters
  - AI-driven post-match performance feedback and coaching tips
- **⏪ Instant Replay System**: Replay and scrub through memorable rallies and match-winning smashes frame-by-frame.
- **🏆 Global & Local Leaderboards**: Track your personal records and climb the scoreboards.

---

## 🕹️ Controls & Input Methods

| Input Mode | How It Works |
| :--- | :--- |
| **Mouse / Touchpad** | Click and drag or move your cursor to angle and swing your racket. |
| **Smartphone Gyro Bat** | Scan the QR / pairing code on your phone to turn your phone into a physical racket. Calibrate and swing naturally! |
| **MediaPipe Hand Tracking** | Enable camera access to control your paddle directly with palm gestures. |
| **Voice Commands** | Speak phrases like *"serve"*, *"pause"*, or *"restart"* during play. |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (version 18 or higher recommended)
- `npm` or `yarn`

### 1. Clone & Install Dependencies

```bash
git clone https://github.com/SaifuddinM23/table-tennis.git
cd table-tennis
npm install
```

### 2. Start the Development Server

To launch the frontend game client:

```bash
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

### 3. Start the Multiplayer & Mobile Controller Server

For online matchmaking and the smartphone gyroscope racket pairing features, launch the Node.js Socket.IO server:

```bash
npm run server
```

The WebSocket server runs on port `3005` (or as configured). When your desktop and phone are connected to the same Wi-Fi network, navigate to the local IP address shown in the terminal.

---

## 📱 Mobile Gyroscope Racket Setup

1. Run the local backend (`npm run server`) and frontend (`npm run dev -- --host`).
2. Open the desktop game and select **Phone Controller Mode**.
3. On your mobile phone, open the pairing link or enter the room code.
4. Grant Device Motion / Orientation permissions when prompted by your mobile browser.
5. Tap **Calibrate** while pointing your phone straight towards your monitor.
6. Swing away!

---

## 🛠️ Tech Stack

- **Frontend UI**: React 19, CSS modules / modern design tokens, Lucide Icons
- **3D Graphics & Shaders**: Three.js
- **Computer Vision**: Google MediaPipe Hands & Camera Utils
- **Networking**: Socket.IO, Express
- **Build Tooling**: Vite
- **Deployment**: GitHub Pages (`gh-pages`)

---

## 📦 Scripts

- `npm run dev`: Starts the local Vite development server.
- `npm run build`: Compiles production assets into `dist/`.
- `npm run preview`: Locally previews the production build.
- `npm run server`: Launches the Express & Socket.IO backend.
- `npm run deploy`: Builds and deploys the latest version to GitHub Pages.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
