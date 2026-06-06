import React, { useState, useEffect } from 'react';
import { Trophy, ShieldAlert, Award } from 'lucide-react';

const DEFAULT_LEADERBOARD = [
  { name: 'Sven "Spin" Vlas', elo: 1950, wins: 45, losses: 12 },
  { name: 'AI Coach (Pro)', elo: 1650, wins: 32, losses: 18 },
  { name: 'Paddler Prime', elo: 1420, wins: 24, losses: 15 },
  { name: 'Player (You)', elo: 1200, wins: 0, losses: 0 },
  { name: 'Novice Pong', elo: 1000, wins: 5, losses: 12 }
];

export function calculateNewElo(playerElo, opponentElo, playerWin, kFactor = 32) {
  const expectedPlayer = 1 / (1 + Math.pow(10, (opponentElo - playerElo) / 400));
  const actualPlayer = playerWin ? 1 : 0;
  const newPlayerElo = Math.round(playerElo + kFactor * (actualPlayer - expectedPlayer));
  
  const expectedOpponent = 1 / (1 + Math.pow(10, (playerElo - opponentElo) / 400));
  const actualOpponent = playerWin ? 0 : 1;
  const newOpponentElo = Math.round(opponentElo + kFactor * (actualOpponent - expectedOpponent));

  return { player: newPlayerElo, opponent: newOpponentElo };
}

export default function Leaderboard({ matchResult }) {
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    // Load leaderboard from localStorage or save default
    const stored = localStorage.getItem('pingpong_leaderboard');
    let currentLeaderboard = [];

    if (stored) {
      currentLeaderboard = JSON.parse(stored);
    } else {
      currentLeaderboard = [...DEFAULT_LEADERBOARD];
      localStorage.setItem('pingpong_leaderboard', JSON.stringify(currentLeaderboard));
    }

    // Process fresh match results if available
    if (matchResult && matchResult.processed !== true) {
      const { playerWon, opponentName, opponentElo } = matchResult;

      // Find Player and Opponent in leaderboard list
      let playerIdx = currentLeaderboard.findIndex(p => p.name.includes('(You)'));
      if (playerIdx === -1) {
        currentLeaderboard.push({ name: 'Player (You)', elo: 1200, wins: 0, losses: 0 });
        playerIdx = currentLeaderboard.length - 1;
      }

      let opponentIdx = currentLeaderboard.findIndex(p => p.name === opponentName);
      if (opponentIdx === -1) {
        currentLeaderboard.push({ name: opponentName, elo: opponentElo || 1100, wins: 0, losses: 0 });
        opponentIdx = currentLeaderboard.length - 1;
      }

      const pElo = currentLeaderboard[playerIdx].elo;
      const oElo = currentLeaderboard[opponentIdx].elo;

      // Calculate new ratings
      const newRatings = calculateNewElo(pElo, oElo, playerWon);
      
      currentLeaderboard[playerIdx].elo = newRatings.player;
      currentLeaderboard[opponentIdx].elo = newRatings.opponent;

      if (playerWon) {
        currentLeaderboard[playerIdx].wins++;
        currentLeaderboard[opponentIdx].losses++;
      } else {
        currentLeaderboard[playerIdx].losses++;
        currentLeaderboard[opponentIdx].wins++;
      }

      // Mark result as processed to avoid double calculations
      matchResult.processed = true;

      // Save updated list
      localStorage.setItem('pingpong_leaderboard', JSON.stringify(currentLeaderboard));
    }

    // Sort by ELO rating descending
    const sorted = [...currentLeaderboard].sort((a, b) => b.elo - a.elo);
    setPlayers(sorted);
  }, [matchResult]);

  return (
    <div className="leaderboard-panel glassmorphism">
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
        <Trophy color="#ffd700" size={20} />
        <span className="leaderboard-title">Hyperspace Ranks</span>
      </div>

      <div className="leaderboard-list">
        {players.map((player, index) => {
          const isYou = player.name.includes('(You)');
          let rankClass = '';
          if (index === 0) rankClass = 'rank-1';
          else if (index === 1) rankClass = 'rank-2';
          else if (index === 2) rankClass = 'rank-3';

          return (
            <div
              key={player.name}
              className={`leaderboard-item ${isYou ? 'highlight' : ''}`}
            >
              <div className="player-rank-name">
                <span className={`rank-badge ${rankClass}`}>{index + 1}</span>
                <span className="player-name-text" style={{ color: isYou ? '#00f3ff' : 'white' }}>
                  {player.name}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <span style={{ fontSize: '0.7rem', color: '#8892b0' }}>
                  {player.wins}W - {player.losses}L
                </span>
                <span className="player-elo-text">{player.elo} ELO</span>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ fontSize: '0.7rem', color: '#8892b0', textAlign: 'center', marginTop: '6px' }}>
        Climb the ladder by defeating AI bots or other online peers!
      </div>
    </div>
  );
}
