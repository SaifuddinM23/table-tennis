// Ping Pong Game Physics Engine

export const TABLE_WIDTH = 1.525; // x-axis
export const TABLE_LENGTH = 2.74;  // z-axis
export const TABLE_HEIGHT = 0.0;   // table top surface is at y = 0
export const NET_HEIGHT = 0.1525;  // net height along y-axis
export const BALL_RADIUS = 0.02;   // 20mm ball radius
export const PADDLE_RADIUS = 0.1;  // 10cm paddle radius

export const COURT_LIMITS = {
  xMin: -TABLE_WIDTH / 2,
  xMax: TABLE_WIDTH / 2,
  zMin: -TABLE_LENGTH / 2,
  zMax: TABLE_LENGTH / 2
};

// Per-difficulty speed escalation settings
const DIFFICULTY_CONFIG = {
  easy:   { serveSpeed: 3.2, aiSpeedMult: 0.95, rallyAccel: 0.015, maxSpeed: 8.5 },
  medium: { serveSpeed: 3.6, aiSpeedMult: 1.00, rallyAccel: 0.030, maxSpeed: 11.5 },
  pro:    { serveSpeed: 4.0, aiSpeedMult: 1.12, rallyAccel: 0.060, maxSpeed: 14.5 }
};

export class PingPongPhysics {
  constructor() {
    this.resetBall();
    this.score = { player: 0, opponent: 0 };
    this.gameState = 'menu';
    this.servingPlayer = 'player';
    this.lastHitter = null;
    this.rallyHitCount = 0;       // how many paddle hits this rally
    this.bouncesThisRally = [];
    this.activeRally = [];
    this.rallyLog = [];
    this.maxRallyLength = 0;
    this.maxSpeed = 0;
    this.difficulty = 'medium';
    this.mode = 'singleplayer';    // Default to singleplayer auto-serving
    this.playerLastPos = { x: 0, y: 0.15 };
    // track the last side the ball bounced on to apply simple rules
    this.lastBounceSide = null;
    this.bounceCountThisSide = 0;
    this.serveTimeoutActive = false;
    this.aiErrorType = null;
    this.aiDecidesToChaseOut = true;
  }

  resetBall() {
    this.ball = {
      x: 0, y: 1.0, z: 0.8,
      vx: 0, vy: 0, vz: 0,
      spinX: 0, spinY: 0,
      trail: []
    };
    this.lastHitter = null;
    this.rallyHitCount = 0;
    this.bouncesThisRally = [];
    this.activeRally = [];
    this.lastBounceSide = null;
    this.bounceCountThisSide = 0;
    this.aiErrorType = null;
    this.hasBouncedThisHit = false;
  }

  serveBall(hitter) {
    this.resetBall();
    this.lastHitter = hitter;
    const cfg = DIFFICULTY_CONFIG[this.difficulty] || DIFFICULTY_CONFIG.medium;
    const spd = cfg.serveSpeed;

    if (hitter === 'player') {
      // Ball starts near player end, travels to opponent's side
      this.ball.x = (Math.random() - 0.5) * 0.2;
      this.ball.y = 0.28;                  // above table surface
      this.ball.z = TABLE_LENGTH / 2 - 0.20;
      this.ball.vx = (Math.random() - 0.5) * 0.3;
      this.ball.vy = 2.8;                  // arc upward so it clears net
      this.ball.vz = -spd;
    } else {
      // AI serve: ball starts near opponent end, travels to player's side
      this.ball.x = (Math.random() - 0.5) * 0.2;
      this.ball.y = 0.28;
      this.ball.z = -TABLE_LENGTH / 2 + 0.20;
      this.ball.vx = (Math.random() - 0.5) * 0.3;
      this.ball.vy = 2.8;                  // arc upward so it clears net
      this.ball.vz = spd;
    }
    this.gameState = 'playing';
  }

  update(dt, playerPaddle, opponentPaddle) {
    if (this.gameState !== 'playing') {
      // Auto-serve in singleplayer mode when stuck in a serve state
      if (this.mode !== 'multiplayer') {
        if ((this.gameState === 'serve_player' || this.gameState === 'serve_opponent') && !this.serveTimeoutActive) {
          this.serveTimeoutActive = true;
          const server = this.gameState === 'serve_player' ? 'player' : 'opponent';
          setTimeout(() => {
            this.serveTimeoutActive = false;
            if (this.gameState === 'serve_player' || this.gameState === 'serve_opponent') {
              this.serveBall(server);
            }
          }, 1500);
        }
      }
      return;
    }

    this.playerLastPos = { x: playerPaddle.x, y: playerPaddle.y };

    // 1. Gravity
    const g = -9.8;
    this.ball.vy += g * dt;

    // 2. Air drag
    const drag = 0.12;
    this.ball.vx -= this.ball.vx * drag * dt;
    this.ball.vy -= this.ball.vy * drag * dt;
    this.ball.vz -= this.ball.vz * drag * dt;

    // 3. Magnus effect
    const magnusFactor = 0.4;
    this.ball.vy -= this.ball.spinX * Math.abs(this.ball.vz) * magnusFactor * dt;
    this.ball.vx += this.ball.spinY * Math.abs(this.ball.vz) * magnusFactor * dt;

    // 4. Move
    this.ball.x += this.ball.vx * dt;
    this.ball.y += this.ball.vy * dt;
    this.ball.z += this.ball.vz * dt;

    // 5. Track max speed
    const spd = Math.sqrt(this.ball.vx**2 + this.ball.vy**2 + this.ball.vz**2);
    if (spd > this.maxSpeed) this.maxSpeed = spd;

    // 6. Ball trail
    this.ball.trail.push({ x: this.ball.x, y: this.ball.y, z: this.ball.z });
    if (this.ball.trail.length > 20) this.ball.trail.shift();

    // 7. Record rally frame
    this.activeRally.push({
      ball: { ...this.ball },
      player: { x: playerPaddle.x, y: playerPaddle.y, z: playerPaddle.z },
      opponent: { x: opponentPaddle.x, y: opponentPaddle.y, z: opponentPaddle.z }
    });

    // 8. Collisions
    this.checkTableBounce();
    // Enable net collision so hitting the net commits a foul
    this.checkNetCollision(dt);
    this.checkPaddleCollision(playerPaddle, 'player', dt);
    this.checkPaddleCollision(opponentPaddle, 'opponent', dt);
    this.checkOutOfBounds();
  }

  checkTableBounce() {
    if (this.ball.y <= BALL_RADIUS && this.ball.vy < 0) {
      const withinX = this.ball.x >= COURT_LIMITS.xMin && this.ball.x <= COURT_LIMITS.xMax;
      const withinZ = this.ball.z >= COURT_LIMITS.zMin && this.ball.z <= COURT_LIMITS.zMax;

      if (withinX && withinZ) {
        this.ball.y = BALL_RADIUS;
        const restitution = 0.88;
        this.ball.vy = -this.ball.vy * restitution;

        const spinFriction = 0.12;
        this.ball.vz += this.ball.spinX * spinFriction;
        this.ball.vx += this.ball.spinY * spinFriction;
        this.ball.spinX *= 0.5;
        this.ball.spinY *= 0.5;

        // Determine which side bounced
        const side = this.ball.z > 0 ? 'player' : 'opponent';

        // Check if the bounce is on the expected receiver's side
        const expectedReceiver = this.lastHitter === 'player' ? 'opponent' : 'player';
        if (side === expectedReceiver) {
          this.hasBouncedThisHit = true;
        } else if (this.lastHitter !== null) {
          // Bounced on hitter's own side during play - point to opponent
          this.awardPoint(expectedReceiver, `${this.lastHitter} bounced the ball on their own side.`);
          return;
        }

        // ── SIMPLIFIED BOUNCE SCORING RULES ──
        // A point is only lost if the ball bounces TWICE on the receiver's side
        // (i.e. the receiver failed to hit it before the second bounce)
        if (side === this.lastBounceSide) {
          this.bounceCountThisSide++;
          if (this.bounceCountThisSide >= 2) {
            // Double bounce — receiver missed. Award point to whoever last hit.
            const loser = side; // the side that let it bounce twice
            const winner = loser === 'player' ? 'opponent' : 'player';
            this.awardPoint(winner, `${loser} failed to return — double bounce.`);
            return;
          }
        } else {
          this.lastBounceSide = side;
          this.bounceCountThisSide = 1;
        }

        this.bouncesThisRally.push({ x: this.ball.x, z: this.ball.z, side });
        this.triggerAudio('bounce');
      }
    }
  }

  checkNetCollision(dt) {
    // Gracefully bypass net collision check for player hits to guarantee it never touches/snags the net
    if (this.lastHitter === 'player') return;

    const netWidth = TABLE_WIDTH + 0.15;
    const prevZ = this.ball.z - this.ball.vz * dt;
    const crossedNet = (prevZ < 0 && this.ball.z >= 0) || (prevZ > 0 && this.ball.z <= 0);

    if (crossedNet && Math.abs(this.ball.x) <= netWidth / 2) {
      const t = -prevZ / (this.ball.z - prevZ);
      const yAtNet = this.ball.y - this.ball.vy * dt * (1 - t);

      if (yAtNet <= NET_HEIGHT) {
        this.triggerAudio('net');
        this.ball.z = prevZ;
        this.ball.vz = -this.ball.vz * 0.25; // bounce off net slightly
        this.ball.vy = Math.abs(this.ball.vy) * 0.2;
        this.ball.vx *= 0.5;
        this.ball.spinX *= 0.2;
        this.ball.spinY *= 0.2;
      }
    }
  }

  checkPaddleCollision(paddle, name, dt) {
    // Prevent hitting if the ball is already moving away from the hitter
    if (name === 'player' && this.ball.vz < 0) return;
    if (name === 'opponent' && this.ball.vz > 0) return;
    // Bypass collision if the AI is set to miss the ball
    if (name === 'opponent' && this.aiErrorType === 'miss') return;

    const paddleZ = paddle.z;
    const prevZ = this.ball.z - this.ball.vz * dt;

    const crossedPlane =
      (name === 'player'   && ((prevZ <= paddleZ && this.ball.z >= paddleZ) || (prevZ >= paddleZ && this.ball.z <= paddleZ))) ||
      (name === 'opponent' && ((prevZ >= paddleZ && this.ball.z <= paddleZ) || (prevZ <= paddleZ && this.ball.z >= paddleZ)));

    if (crossedPlane || Math.abs(this.ball.z - paddleZ) < BALL_RADIUS * 2) {
      const dx = this.ball.x - paddle.x;
      const dy = this.ball.y - paddle.y;
      const distSq = dx * dx + dy * dy;
      const effectiveRadius = name === 'player' ? 0.25 : PADDLE_RADIUS;

      if (distSq <= (effectiveRadius + BALL_RADIUS) ** 2) {
        // ── HIT ──
        this.lastHitter = name;
        this.rallyHitCount++;
        this.hasBouncedThisHit = false;
        // Reset bounce tracking — receiver now has a fresh slate
        this.lastBounceSide = null;
        this.bounceCountThisSide = 0;
        this.triggerAudio('hit');

        // Compute effective swing speed for the hit callback
        let hitSpeed = 0;
        if (name === 'player') {
          const coordinateSwing = paddle.vz ? Math.abs(paddle.vz) : 0;
          hitSpeed = Math.max(paddle.swingSpeed || 0, coordinateSwing * 3.5);
          // Decide randomly (50% chance) if the AI will chase this ball if it goes out of bounds
          this.aiDecidesToChaseOut = Math.random() > 0.50;
        }

        // Trigger external callback if registered
        if (typeof this.onPaddleHit === 'function') {
          this.onPaddleHit(name, hitSpeed);
        }

        const cfg = DIFFICULTY_CONFIG[this.difficulty] || DIFFICULTY_CONFIG.medium;
        // Escalate speed every hit based on difficulty
        const maxRallyBonus = this.difficulty === 'pro' ? 1.5 : (this.difficulty === 'medium' ? 1.2 : 1.05);
        const rallyBonus = Math.min(maxRallyBonus, 1 + this.rallyHitCount * cfg.rallyAccel);

        if (name === 'player') {
          // Roll for AI mistake on the upcoming return
          const errorChance = this.difficulty === 'easy' ? 0.32 : (this.difficulty === 'medium' ? 0.15 : 0.04);
          if (Math.random() < errorChance) {
            const roll = Math.random();
            if (roll < 0.35) {
              this.aiErrorType = 'miss'; // complete miss
            } else if (roll < 0.65) {
              this.aiErrorType = 'net'; // hit into net
            } else if (roll < 0.85) {
              this.aiErrorType = 'wide'; // hit wide
            } else {
              this.aiErrorType = 'long'; // hit long
            }
          } else {
            this.aiErrorType = null;
          }

          // ── PLAYER HIT: always goes to opponent's court ──
          this.ball.z = paddleZ - BALL_RADIUS - 0.01;
          this.ball.y = Math.max(0.18, this.ball.y);

          // Target a random but valid spot in opponent's court
          const targetZ = -0.60 - Math.random() * 0.55;
          let targetX = (Math.random() - 0.5) * 0.6;
          const swipeX = paddle.vx || 0;
          if (swipeX > 1.5)  targetX =  0.25 + Math.random() * 0.25;
          if (swipeX < -1.5) targetX = -0.25 - Math.random() * 0.25;
          targetX = Math.max(-0.60, Math.min(0.60, targetX));

          // Forward speed based on difficulty — capped to prevent wide side shots
          const baseVz = cfg.serveSpeed * rallyBonus;
          
          // Combine accelerometer swingSpeed with physical coordinate velocity vz as a backup/booster
          const coordinateSwing = paddle.vz ? Math.abs(paddle.vz) : 0;
          const effectiveSwingSpeed = Math.max(
            paddle.swingSpeed || 0,
            coordinateSwing * 3.5
          );

          let swingMultiplier = 1.0;
          if (effectiveSwingSpeed > 6.0) {
            // Map swing speed (6 to 25) to a multiplier (1.0 to 1.5)
            swingMultiplier = 1.0 + Math.min(0.5, (effectiveSwingSpeed - 6.0) * 0.026);
          }
          this.ball.vz = -Math.min(baseVz * swingMultiplier, cfg.maxSpeed * 0.95);

          // Lateral velocity calculated from target position
          const distZ = targetZ - this.ball.z;
          const flightTime = Math.abs(distZ) / Math.max(0.1, Math.abs(this.ball.vz));
          this.ball.vx = Math.max(-4.0, Math.min(4.0, (targetX - this.ball.x) / flightTime));

          // Guarantee ball clears net dynamically — compute minimum vy needed
          const distToNet = Math.abs(this.ball.z);                     // ball is on player side (z>0)
          const tNet = distToNet / Math.max(0.1, Math.abs(this.ball.vz));
          // Add extra safety buffer for topspin downward Magnus drag drop
          const spinOffset = this.ball.spinX > 0 ? this.ball.spinX * 0.28 : 0;
          const clearance = NET_HEIGHT + 0.16 + spinOffset;            // 16cm baseline clearance + topspin offset
          const minVy = (clearance - this.ball.y + 4.9 * tNet * tNet) / Math.max(0.01, tNet);
          this.ball.vy = Math.min(7.5, Math.max(minVy, 1.8));          // raised clamp to 7.5 to allow safe clearance launch

          // Apply spin based on raw velocity or detected gyro spinType
          if (paddle.spinType === 'topspin') {
            this.ball.spinX = 0.8; // Topspin: heavy downward Magnus dip
          } else if (paddle.spinType === 'backspin') {
            this.ball.spinX = -0.8; // Backspin/Slice: high float
          } else {
            this.ball.spinX = (paddle.vy || 0) * 0.8;
          }
          this.ball.spinY = (paddle.vx || 0) * 0.8;

        } else {
          // ── AI HIT: always goes to player's court (unless fouling) ──
          this.ball.z = paddleZ + BALL_RADIUS + 0.01;
          this.ball.y = Math.max(0.18, this.ball.y);

          let targetX;
          let targetZ;
          let targetClearance = 0.08; // default clearance above net

          if (this.aiErrorType === 'wide') {
            // Hit wide (out of bounds side)
            targetX = Math.random() > 0.5 ? 0.95 : -0.95;
            targetZ = 0.60 + Math.random() * 0.55;
          } else if (this.aiErrorType === 'long') {
            // Hit long (out of bounds end)
            targetX = (Math.random() - 0.5) * 0.50;
            targetZ = 1.65 + Math.random() * 0.35;
          } else if (this.aiErrorType === 'net') {
            // Hit directly into net
            targetX = (Math.random() - 0.5) * 0.50;
            targetZ = 0.60 + Math.random() * 0.55;
            targetClearance = -0.05; // below the top of net
          } else {
            // Normal hit
            if (this.difficulty === 'pro') {
              targetX = this.playerLastPos.x > 0.1
                ? -(0.30 + Math.random() * 0.20)
                :  (0.30 + Math.random() * 0.20);
            } else if (this.difficulty === 'medium') {
              targetX = (Math.random() - 0.5) * 0.50;
            } else {
              targetX = (Math.random() - 0.5) * 0.25;
            }
            targetZ = 0.60 + Math.random() * 0.55;
          }

          // Forward speed — AI speed multiplier controls how fast it sends back
          let baseVz = cfg.serveSpeed * cfg.aiSpeedMult * rallyBonus;
          if (this.aiErrorType === 'long') baseVz *= 1.25;
          this.ball.vz = Math.min(baseVz, cfg.maxSpeed * 0.85);

          // Lateral velocity from target
          const distZ = targetZ - this.ball.z;
          const flightTime = Math.abs(distZ) / Math.max(0.1, this.ball.vz);
          this.ball.vx = Math.max(-3.5, Math.min(3.5, (targetX - this.ball.x) / flightTime));

          // Guarantee ball clears net dynamically (or hit net for net error)
          const distToNet = Math.abs(this.ball.z);                     // AI is on opponent side (z<0)
          const tNet = distToNet / Math.max(0.1, Math.abs(this.ball.vz));
          // Raised baseline target clearance to 16cm for AI normal shots, keeping error shots below net if targeted
          const clearance = NET_HEIGHT + (targetClearance === 0.08 ? 0.16 : targetClearance);
          const minVy = (clearance - this.ball.y + 4.9 * tNet * tNet) / Math.max(0.01, tNet);
          this.ball.vy = Math.min(7.5, Math.max(minVy, 1.8));

          if (this.difficulty === 'pro') {
            this.ball.spinX = 0.3 + Math.random() * 0.3;
            this.ball.spinY = (Math.random() - 0.5) * 0.4;
          } else {
            this.ball.spinX = 0;
            this.ball.spinY = 0;
          }
        }

        // Hard cap on horizontal speed only — do NOT touch vy or the ball drops into net
        const horzSpd = Math.sqrt(this.ball.vx**2 + this.ball.vz**2);
        const horzMax = cfg.maxSpeed * 0.90;
        if (horzSpd > horzMax) {
          const r = horzMax / horzSpd;
          this.ball.vx *= r;
          this.ball.vz *= r;
        }
      }
    }
  }

  checkOutOfBounds() {
    // Ball fell off table or flew way out
    if (this.ball.y < -0.6 || Math.abs(this.ball.x) > 3.0 || Math.abs(this.ball.z) > 2.6) {
      if (this.lastHitter === null) {
        this.resetBall();
        this.gameState = this.servingPlayer === 'player' ? 'serve_player' : 'serve_opponent';
        return;
      }

      const loser = this.lastHitter;
      const winner = loser === 'player' ? 'opponent' : 'player';

      // Rule: if the ball did not bounce on the receiver's side after this hit,
      // the hitter gets penalized (point awarded to the opponent)
      if (!this.hasBouncedThisHit) {
        this.awardPoint(winner, `${loser} hit the ball out without touching the table.`);
      } else {
        // If it did bounce, the hitter wins the point since the receiver failed to return it
        this.awardPoint(loser, `${winner} failed to return after table bounce.`);
      }
    }
  }

  awardPoint(winner, reason) {
    this.score[winner]++;
    this.gameState = 'point_scored';

    // Save rally replay
    const rallyRecord = {
      winner, reason,
      score: { ...this.score },
      maxRallySpeed: this.maxSpeed,
      frameCount: this.activeRally.length,
      frames: [...this.activeRally],
      bounces: [...this.bouncesThisRally]
    };
    this.rallyLog.push(rallyRecord);
    if (this.bouncesThisRally.length > this.maxRallyLength) {
      this.maxRallyLength = this.bouncesThisRally.length;
    }

    this.triggerAudio('score');

    // Check game over (first to 11, 2 ahead)
    if (this.score.player >= 11 && this.score.player - this.score.opponent >= 2) {
      this.gameState = 'game_over';
      this.winner = 'player';
      return;
    }
    if (this.score.opponent >= 11 && this.score.opponent - this.score.player >= 2) {
      this.gameState = 'game_over';
      this.winner = 'opponent';
      return;
    }

    // Alternate serve every 2 points
    const totalPoints = this.score.player + this.score.opponent;
    this.servingPlayer = Math.floor(totalPoints / 2) % 2 === 0 ? 'player' : 'opponent';

    // Transition to the serve state after a short pause (1.5 seconds)
    // Both singleplayer and multiplayer follow this transition.
    // In singleplayer, our update loop will automatically trigger the serve.
    setTimeout(() => {
      if (this.gameState === 'point_scored') {
        this.gameState = this.servingPlayer === 'player' ? 'serve_player' : 'serve_opponent';
        this.resetBall();
      }
    }, 1500);
  }

  // Web Audio API sounds
  triggerAudio(type) {
    if (typeof window === 'undefined') return;
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);

      if (type === 'hit') {
        // Realistic plastic ball hitting a racket (deeper wood/rubber click with hollow resonance)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1400, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(720, ctx.currentTime + 0.004); // fast transient slap
        osc.frequency.exponentialRampToValueAtTime(520, ctx.currentTime + 0.045); // body resonance decay
        
        gain.gain.setValueAtTime(0.35, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.24, ctx.currentTime + 0.004);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);
        osc.start(); 
        osc.stop(ctx.currentTime + 0.045);
      } else if (type === 'bounce') {
        // Realistic plastic ball hitting a hard wood table (higher pitch pock/clack)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1800, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(1050, ctx.currentTime + 0.003); // sharp contact transient
        osc.frequency.exponentialRampToValueAtTime(800, ctx.currentTime + 0.035);  // hollow plastic shell resonance
        
        gain.gain.setValueAtTime(0.32, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.22, ctx.currentTime + 0.003);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);
        osc.start(); 
        osc.stop(ctx.currentTime + 0.035);
      } else if (type === 'net') {
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(70, ctx.currentTime + 0.12);
        gain.gain.setValueAtTime(0.3, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(); 
        osc.stop(ctx.currentTime + 0.12);
      } else if (type === 'score') {
        osc.frequency.setValueAtTime(600, ctx.currentTime);
        osc.frequency.setValueAtTime(820, ctx.currentTime + 0.1);
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        osc.start(); 
        osc.stop(ctx.currentTime + 0.3);
      }
    } catch (e) {
      console.warn('Audio failed', e);
    }
  }
}
