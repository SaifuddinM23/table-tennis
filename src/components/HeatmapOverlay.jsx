import React, { useEffect, useRef } from 'react';
import { TABLE_WIDTH, TABLE_LENGTH } from '../physics/PingPongPhysics';

export default function HeatmapOverlay({ rallyLog }) {
  const canvasRef = useRef(null);

  // Extract all bounces from the match rally history log
  const allBounces = rallyLog ? rallyLog.flatMap(rally => rally.bounces || []) : [];

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const w = canvas.width;
    const h = canvas.height;

    // 1. Draw Table Background (Futuristic Grid / Dark Blue Court)
    ctx.fillStyle = '#101024';
    ctx.fillRect(0, 0, w, h);

    // Grid lines for court decoration
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSpacing = 20;
    for (let x = 0; x < w; x += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += gridSpacing) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
    }

    // 2. Draw Table Borders (White Lines)
    const margin = 15;
    const courtW = w - 2 * margin;
    const courtH = h - 2 * margin;

    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 3;
    ctx.strokeRect(margin, margin, courtW, courtH);

    // Center dividing line (Horizontal - standard table double lines)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(w / 2, margin);
    ctx.lineTo(w / 2, h - margin);
    ctx.stroke();

    // Center Net Line (vertical in top-down projection: Net is at z = 0, which is exact middle)
    ctx.strokeStyle = '#00f3ff'; // glowing cyan net representation
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(margin - 5, h / 2);
    ctx.lineTo(w - margin + 5, h / 2);
    ctx.stroke();

    // Side labels
    ctx.fillStyle = 'rgba(255, 0, 127, 0.25)';
    ctx.font = 'bold 11px Orbitron, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('AI SIDE', w / 2, margin + 25);

    ctx.fillStyle = 'rgba(0, 243, 255, 0.25)';
    ctx.fillText('YOUR SIDE', w / 2, h - margin - 20);

    // 3. Render Bounce Heatmap dots
    // Table coordinate space: 
    // X goes from -0.7625 to +0.7625
    // Z goes from -1.37 to +1.37
    // Map table coords to canvas coords:
    const scaleX = courtW / TABLE_WIDTH;
    const scaleZ = courtH / TABLE_LENGTH;

    allBounces.forEach((bounce) => {
      // Coordinate conversions:
      // table center is x=0, z=0. Map to canvas center (w/2, h/2).
      // Since Z increases towards player (+z is player, -z is opponent)
      // canvas Y decreases upwards, so z = -1.37 maps to top of canvas (AI side)
      // z = +1.37 maps to bottom of canvas (Player side)
      const cx = w / 2 + bounce.x * scaleX;
      const cy = h / 2 + bounce.z * scaleZ;

      // Color mapping: Player shots bounce on Opponent side (top half of canvas)
      // Opponent shots bounce on Player side (bottom half of canvas)
      const isPlayerHitter = bounce.hitter === 'player';
      const color = isPlayerHitter ? 'rgba(0, 243, 255,' : 'rgba(255, 0, 127,';

      // Draw Heat Radial Gradient (thermal glow)
      const radGrad = ctx.createRadialGradient(cx, cy, 2, cx, cy, 18);
      radGrad.addColorStop(0, `${color} 1)`);
      radGrad.addColorStop(0.3, `${color} 0.5)`);
      radGrad.addColorStop(1, `${color} 0)`);

      ctx.fillStyle = radGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, 18, 0, Math.PI * 2);
      ctx.fill();
    });

    // Draw little outline rings around latest 3 bounces to emphasize accuracy
    const latestBounces = allBounces.slice(-3);
    latestBounces.forEach((bounce) => {
      const cx = w / 2 + bounce.x * scaleX;
      const cy = h / 2 + bounce.z * scaleZ;
      const isPlayer = bounce.hitter === 'player';
      
      ctx.strokeStyle = isPlayer ? '#00f3ff' : '#ff007f';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, 4, 0, Math.PI * 2);
      ctx.stroke();
    });

  }, [allBounces]);

  const playerHitsCount = allBounces.filter(b => b.hitter === 'player').length;
  const opponentHitsCount = allBounces.filter(b => b.hitter === 'opponent').length;

  return (
    <div className="heatmap-card glassmorphism">
      <h3>Shot Placement Heatmap</h3>
      
      <div className="heatmap-canvas-wrapper">
        <canvas
          ref={canvasRef}
          width={180}
          height={320}
          style={{ width: '180px', height: '320px' }}
        />
      </div>

      <div className="heatmap-stats">
        <div className="heatmap-stat-item">
          <span>Your Bounces</span>
          <span className="heatmap-stat-val" style={{ color: '#00f3ff' }}>{playerHitsCount}</span>
        </div>
        <div className="heatmap-stat-item">
          <span>AI Bounces</span>
          <span className="heatmap-stat-val" style={{ color: '#ff007f' }}>{opponentHitsCount}</span>
        </div>
      </div>
      <div style={{ fontSize: '0.7rem', color: '#8892b0', textAlign: 'center' }}>
        Heat glows represent bounce density. Targets near lines score more aces.
      </div>
    </div>
  );
}
