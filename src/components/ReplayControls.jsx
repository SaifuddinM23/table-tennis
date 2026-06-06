import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, X, RotateCcw } from 'lucide-react';

export default function ReplayControls({ rallyRecord, onFrameUpdate, onClose }) {
  const [isPlaying, setIsPlaying] = useState(true);
  const [currentFrameIdx, setCurrentFrameIdx] = useState(0);
  const [speed, setSpeed] = useState(1); // 0.25, 0.5, 1, 2
  const timerRef = useRef(null);
  
  const frames = rallyRecord ? rallyRecord.frames : [];
  const totalFrames = frames.length;

  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (!isPlaying || totalFrames === 0) return;

    // Calculate interval based on 60fps (16.6ms) divided by speed multiplier
    const intervalMs = Math.round(16.6 / speed);

    timerRef.current = setInterval(() => {
      setCurrentFrameIdx((prev) => {
        if (prev >= totalFrames - 1) {
          // Loop or stop
          setIsPlaying(false);
          return totalFrames - 1;
        }
        return prev + 1;
      });
    }, intervalMs);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speed, totalFrames]);

  // Sync frame update to parent 3D canvas
  useEffect(() => {
    if (frames && frames[currentFrameIdx]) {
      onFrameUpdate(frames[currentFrameIdx]);
    }
  }, [currentFrameIdx, frames, onFrameUpdate]);

  const handlePlayPause = () => {
    if (currentFrameIdx >= totalFrames - 1) {
      setCurrentFrameIdx(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleSliderChange = (e) => {
    setIsPlaying(false);
    setCurrentFrameIdx(parseInt(e.target.value, 10));
  };

  const formatTime = (frameIdx) => {
    const totalSeconds = (frameIdx * 0.0166).toFixed(2);
    return `${totalSeconds}s`;
  };

  if (!rallyRecord || totalFrames === 0) {
    return (
      <div className="replay-overlay glassmorphism">
        <p>No replay files logged yet. Play a point to record!</p>
      </div>
    );
  }

  return (
    <div className="replay-overlay glassmorphism">
      <div className="replay-header">
        <div className="replay-title">
          <span className="dot" style={{ backgroundColor: '#39ff14', width: 8, height: 8, borderRadius: '50%', display: 'inline-block' }}></span>
          <span>Point Replay - Winner: {rallyRecord.winner === 'player' ? 'You' : 'Opponent'}</span>
        </div>
        <button className="replay-close" onClick={onClose} title="Close Replay">
          <X size={18} />
        </button>
      </div>

      <div className="replay-controls-row">
        <button className="replay-play-btn" onClick={handlePlayPause}>
          {isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>

        <div className="replay-slider-container">
          <input
            type="range"
            className="replay-slider"
            min={0}
            max={totalFrames - 1}
            value={currentFrameIdx}
            onChange={handleSliderChange}
          />
          <div className="replay-time">
            {formatTime(currentFrameIdx)} / {formatTime(totalFrames - 1)}
          </div>
        </div>

        <div className="replay-speed-controls">
          {[0.25, 0.5, 1, 2].map((s) => (
            <button
              key={s}
              className={`replay-speed-btn ${speed === s ? 'active' : ''}`}
              onClick={() => setSpeed(s)}
            >
              {s}x
            </button>
          ))}
        </div>
      </div>
      <div style={{ fontSize: '0.75rem', color: '#8892b0', textAlign: 'center' }}>
        Reason: {rallyRecord.reason} | Max Speed: {(rallyRecord.maxRallySpeed * 3.6).toFixed(1)} km/h
      </div>
    </div>
  );
}
