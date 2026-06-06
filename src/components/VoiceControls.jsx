import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, AlertCircle } from 'lucide-react';

export default function VoiceControls({ onCommand, gameState }) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const recognitionRef = useRef(null);

  const onCommandRef = useRef(onCommand);
  const isListeningRef = useRef(isListening);

  useEffect(() => {
    onCommandRef.current = onCommand;
  }, [onCommand]);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  // 1. Initialize SpeechRecognition once on mount
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setErrorMsg('Voice control not supported in this browser. Try Chrome/Safari.');
      return;
    }

    const rec = new SpeechRecognition();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = 'en-US';

    let lastTriggerTime = 0;
    let lastTriggerCmd = '';

    const triggerCommand = (cmd) => {
      const now = Date.now();
      // Debounce: prevent same command within 1.2 seconds, or any command within 300ms
      if (now - lastTriggerTime < 300) return;
      if (cmd === lastTriggerCmd && now - lastTriggerTime < 1200) return;

      lastTriggerTime = now;
      lastTriggerCmd = cmd;
      console.log(`Speech command triggered: "${cmd}"`);
      onCommandRef.current(cmd);
    };

    rec.onresult = (event) => {
      let finalTranscript = '';
      let interimTranscript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          finalTranscript += event.results[i][0].transcript;
        } else {
          interimTranscript += event.results[i][0].transcript;
        }
      }
      
      const text = (finalTranscript || interimTranscript).trim().toLowerCase();
      if (!text) return;
      setTranscript(text);
      console.log(`Speech command detected: "${text}" (final: ${!!finalTranscript})`);

      // Trigger actions based on commands with aliases
      if (text.includes('start') || text.includes('play') || text.includes('begin')) {
        triggerCommand('start');
      } else if (text.includes('serve') || text.includes('go') || text.includes('hit') || text.includes('throw')) {
        triggerCommand('serve');
      } else if (text.includes('reset') || text.includes('restart') || text.includes('clear')) {
        triggerCommand('reset');
      } else if (text.includes('replay') || text.includes('watch')) {
        triggerCommand('replay');
      } else if (text.includes('pause') || text.includes('stop')) {
        triggerCommand('pause');
      } else if (text.includes('resume') || text.includes('continue')) {
        triggerCommand('resume');
      }
    };

    rec.onerror = (event) => {
      console.error('Speech recognition error', event.error);
      if (event.error === 'not-allowed') {
        setErrorMsg('Microphone access denied.');
        setIsListening(false);
      }
    };

    rec.onend = () => {
      if (isListeningRef.current) {
        // Keep listening unless manually stopped
        try {
          rec.start();
        } catch (e) {
          console.warn("Failed to restart speech recognition", e);
        }
      }
    };

    recognitionRef.current = rec;

    return () => {
      try {
        rec.stop();
      } catch (e) {}
    };
  }, []);

  // 2. Respond to isListening changes to start/stop the mic stream
  useEffect(() => {
    if (!recognitionRef.current) return;
    
    if (isListening) {
      try {
        recognitionRef.current.start();
      } catch (e) {
        console.error("Error starting speech recognition:", e);
      }
    } else {
      try {
        recognitionRef.current.stop();
      } catch (e) {
        console.error("Error stopping speech recognition:", e);
      }
    }
  }, [isListening]);

  const toggleListening = () => {
    if (errorMsg && errorMsg.includes('not supported')) return;
    setIsListening(prev => !prev);
  };

  return (
    <div className="voice-controls-panel glassmorphism">
      <div className="voice-header">
        <h3>Voice Assistant</h3>
        <button
          onClick={toggleListening}
          className={`mic-btn ${isListening ? 'listening' : ''}`}
          title={isListening ? 'Stop Voice Control' : 'Enable Voice Control'}
        >
          {isListening ? (
            <Mic className="icon pulse-animation" color="#00f3ff" size={20} />
          ) : (
            <MicOff className="icon" color="#8892b0" size={20} />
          )}
        </button>
      </div>

      {isListening && (
        <div className="voice-status">
          <div className="listening-indicator">
            <span className="dot"></span>
            <span className="text">Listening...</span>
          </div>
          {transcript && (
            <p className="latest-heard">
              Heard: <span>"{transcript}"</span>
            </p>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="voice-error">
          <AlertCircle size={14} color="#ff3860" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="voice-hints">
        <span className="hints-title">Voice Commands:</span>
        <ul>
          <li><strong>"Start"</strong> / <strong>"Play"</strong> - Start match</li>
          <li><strong>"Serve"</strong> - Serve the ball</li>
          <li><strong>"Pause"</strong> - Pause / Resume match</li>
          <li><strong>"Replay"</strong> - View point replay</li>
          <li><strong>"Reset"</strong> - Reset score</li>
        </ul>
      </div>
    </div>
  );
}
