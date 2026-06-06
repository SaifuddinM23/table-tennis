import React, { useState, useEffect } from 'react';
import { BrainCircuit, Key, Award, AlertTriangle, Sparkles } from 'lucide-react';

export default function AICoach({ score, rallyLog, maxSpeed, maxRallyLength }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('gemini_api_key') || '');
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [report, setReport] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  // Extract match metrics
  const playerWin = score.player > score.opponent;
  const allBounces = rallyLog ? rallyLog.flatMap(r => r.bounces || []) : [];
  const playerBounces = allBounces.filter(b => b.hitter === 'player');
  const opponentBounces = allBounces.filter(b => b.hitter === 'opponent');

  // Shot placements (left side vs right side of table)
  const playerLeftShots = playerBounces.filter(b => b.x < 0).length;
  const playerRightShots = playerBounces.filter(b => b.x >= 0).length;
  
  const speedKmh = (maxSpeed * 3.6).toFixed(1);

  // 1. Local Rule-based Coaching Engine (Fallback)
  const generateLocalReport = () => {
    let summary = `### Match Summary\n`;
    if (playerWin) {
      summary += `Congratulations on your **${score.player} - ${score.opponent}** victory! You controlled the tempo of this match effectively.\n\n`;
    } else {
      summary += `You fell short in a tough **${score.player} - ${score.opponent}** match. Every defeat is just a learning loop on the path to mastery.\n\n`;
    }

    summary += `### Key Metrics Analysis\n`;
    summary += `- **Power Factor**: Your maximum shot speed was **${speedKmh} km/h**. This indicates good forearm acceleration on contact.\n`;
    summary += `- **Endurance**: The longest rally of the match lasted **${maxRallyLength} bounces**. Extended rallies test mental stamina and shot consistency.\n`;
    
    // Placement analysis
    summary += `- **Placement Spread**: You targeted the opponent's **left court** ${playerLeftShots} times and **right court** ${playerRightShots} times. `;
    if (Math.abs(playerLeftShots - playerRightShots) > 5) {
      summary += `Your playstyle is heavily directional. Try to balance your cross-court and down-the-line shots to keep opponents guessing.\n`;
    } else {
      summary += `Excellent spatial variance! You distributed shots evenly, forcing the opponent to pivot frequently.\n`;
    }

    summary += `\n### Coaching Diagnostics\n`;
    if (!playerWin) {
      summary += `1. **Defensive Depth**: Opponent landed shots deep on your baseline. Work on backing off the table slightly when defending high-velocity returns.\n`;
      summary += `2. **Racket Angle Control**: Several unforced errors were caused by over-tilted sweeps. Keep your wrist firm and paddle face vertical during flat blocks.\n`;
    } else {
      summary += `1. **Aggressive Pressing**: Your heavy topspin loops frequently forced the AI back. Continue using high-arc vertical sweeps to pin the opponent deep.\n`;
      summary += `2. **Net Clearance**: You kept the ball low. This restricted the opponent's ability to smash.\n`;
    }

    summary += `\n### Recommended Training Drills\n`;
    summary += `- **Falkenberg Drill**: Move left-to-right, performing 1 backhand, 1 forehand from backhand corner, and 1 forehand from forehand corner. Develops lateral foot speed.\n`;
    summary += `- **Random Placement Blocks**: Practice returning ball to alternating extremes of the court to cement muscle memory for angles.`;

    setReport(summary);
  };

  // 2. Fetch Report from Google Gemini API
  const fetchGeminiReport = async () => {
    if (!apiKey) return;
    setLoading(true);
    setErrorMsg('');

    const promptText = `
      You are a professional Olympic-level Table Tennis Coach.
      Analyze this match performance between the User (Player) and an AI agent:
      - Final Match Score: User ${score.player} - AI ${score.opponent}
      - Winner: ${playerWin ? 'User' : 'AI'}
      - Max ball speed reached: ${speedKmh} km/h
      - Longest rally duration: ${maxRallyLength} bounces
      - User shot placement: ${playerLeftShots} shots on opponent's left court, ${playerRightShots} shots on opponent's right court.
      - Total bounces on court during rally: ${allBounces.length}
      
      Generate a premium, concise coaching critique formatted in Markdown.
      Structure it with:
      ### Match Critique
      A quick summary of the match flow.
      ### Strengths
      Bullet points analyzing what the User did well.
      ### Growth Areas
      Bullet points of mistakes, unforced errors, or placement weaknesses.
      ### Training Drills
      2 concrete drills to improve.
      
      Be professional, analytical, and encouraging. Use bold key terms. Keep it under 280 words.
    `;

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            contents: [{
              parts: [{
                text: promptText
              }]
            }]
          })
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to call Gemini API');
      }

      const data = await response.json();
      const resultText = data.candidates?.[0]?.content?.parts?.[0]?.text;
      
      if (resultText) {
        // Convert double asterisks to strong, etc. simple markdown parsing
        setReport(resultText);
      } else {
        throw new Error('Empty response received from AI Model.');
      }
    } catch (err) {
      console.error(err);
      setErrorMsg(err.message || 'Error communicating with Gemini. Using local analytics.');
      generateLocalReport();
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (apiKey) {
      fetchGeminiReport();
    } else {
      generateLocalReport();
    }
  }, [score, maxSpeed, maxRallyLength, apiKey]);

  const handleSaveKey = (e) => {
    e.preventDefault();
    const key = e.target.elements.keyInput.value.trim();
    setApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    setShowKeyInput(false);
  };

  const clearApiKey = () => {
    setApiKey('');
    localStorage.removeItem('gemini_api_key');
    generateLocalReport();
  };

  // Basic markup parser to render markdown headers/bullets beautifully
  const renderFormattedReport = (text) => {
    return text.split('\n').map((line, index) => {
      if (line.startsWith('### ')) {
        return <h4 key={index} style={{ fontFamily: 'Orbitron, sans-serif', color: '#00f3ff', marginTop: '14px', marginBottom: '8px', fontSize: '0.95rem', letterSpacing: '1px' }}>{line.replace('### ', '')}</h4>;
      }
      if (line.startsWith('- ') || line.startsWith('* ')) {
        // Handle bolding within bullets
        const cleanLine = line.substring(2);
        return <li key={index} style={{ marginLeft: '12px', marginBottom: '4px', listStyleType: 'square' }}>{parseBoldText(cleanLine)}</li>;
      }
      if (line.match(/^\d+\.\s/)) {
        return <li key={index} style={{ marginLeft: '12px', marginBottom: '4px', listStyleType: 'decimal' }}>{parseBoldText(line.replace(/^\d+\.\s/, ''))}</li>;
      }
      return <p key={index} style={{ marginBottom: '6px' }}>{parseBoldText(line)}</p>;
    });
  };

  const parseBoldText = (text) => {
    const parts = text.split(/\*\*(.*?)\*\*/g);
    return parts.map((part, i) => (i % 2 === 1 ? <strong key={i} style={{ color: 'white', fontWeight: 600 }}>{part}</strong> : part));
  };

  return (
    <div className="ai-coach-panel glassmorphism">
      <div className="ai-coach-header">
        <div className="ai-coach-title">
          <BrainCircuit className="pulse-animation" color="#00f3ff" size={20} />
          <span>AI Performance Coach</span>
        </div>
        
        <button
          className="key-config-icon"
          onClick={() => setShowKeyInput(!showKeyInput)}
          title="Configure Gemini API Key"
        >
          <Key size={16} color={apiKey ? '#39ff14' : '#8892b0'} />
        </button>
      </div>

      {showKeyInput && (
        <form onSubmit={handleSaveKey} className="key-input-container">
          <label style={{ fontSize: '0.75rem', color: '#8892b0' }}>Google Gemini API Key:</label>
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              name="keyInput"
              type="password"
              placeholder="Paste AI key..."
              defaultValue={apiKey}
              required
            />
            <button type="submit" className="btn-primary" style={{ padding: '4px 10px', fontSize: '0.75rem', borderRadius: '4px' }}>Save</button>
          </div>
          {apiKey && (
            <button
              type="button"
              onClick={clearApiKey}
              style={{ background: 'transparent', border: 'none', color: '#ff3860', fontSize: '0.7rem', cursor: 'pointer', textAlign: 'left' }}
            >
              Clear saved key
            </button>
          )}
        </form>
      )}

      {loading ? (
        <div className="ai-loading">
          <div className="spinner"></div>
          <span style={{ fontSize: '0.8rem', letterSpacing: '1px' }}>GENERATING COACH ANALYSIS...</span>
        </div>
      ) : (
        <div className="ai-report">
          {apiKey && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: '#39ff14', marginBottom: '8px' }}>
              <Sparkles size={10} />
              <span>Generative Coach active via Gemini 1.5 Pro</span>
            </div>
          )}
          {errorMsg && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.7rem', color: '#ff3860', marginBottom: '8px' }}>
              <AlertTriangle size={10} />
              <span>{errorMsg}</span>
            </div>
          )}
          {renderFormattedReport(report)}
        </div>
      )}
    </div>
  );
}
