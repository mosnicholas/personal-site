import { useState, useEffect } from 'react';

import StreamingText from './components/StreamingText';
import TerminalMode from './components/TerminalMode';
import TextScrambler from './components/TextScrambler';

const App = () => {
  const [showNimo, setShowNimo] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [isTerminalMode, setIsTerminalMode] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    // Check for mode=terminal query parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'terminal') {
      setIsTerminalMode(true);
    }
  }, []);

  useEffect(() => {
    // Show hint after 3 seconds
    const hintTimer = setTimeout(() => {
      setShowHint(true);
    }, 3000);

    return () => clearTimeout(hintTimer);
  }, []);

  useEffect(() => {
    // Listen for ~ or t key to activate terminal mode
    const handleKeyPress = (e: KeyboardEvent) => {
      if (e.key === '~' || e.key === 't') {
        window.location.href = '?mode=terminal';
      }
    };

    // Only add listener if not in terminal mode
    if (!isTerminalMode) {
      document.addEventListener('keydown', handleKeyPress);
      return () => {
        document.removeEventListener('keydown', handleKeyPress);
      };
    }

    return undefined;
  }, [isTerminalMode]);

  // Render terminal mode if query parameter is present
  if (isTerminalMode) {
    return <TerminalMode />;
  }

  // Original site rendering
  return (
    <div className="app">
      <div className="content">
        {!showNimo ? (
          <TextScrambler
            text="nicholas moschopoulos"
            callback={() => {
              setTimeout(() => setShowNimo(true), 500);
            }}
          />
        ) : (
          <>
            <h1 className="nimo-glitch">nimo</h1>
            {!streamingComplete ? (
              <StreamingText
                text="adventurer, cook, and founder of Junior"
                speed={40}
                className="subtitle"
                onComplete={() => setStreamingComplete(true)}
              />
            ) : (
              <div className="subtitle">
                adventurer, cook, and founder of{' '}
                <a
                  href="https://myjunior.ai"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Junior
                </a>
              </div>
            )}
          </>
        )}
      </div>
      {showHint && (
        <div className="terminal-hint">
          Press <span className="key-hint">~</span> for terminal mode
        </div>
      )}
    </div>
  );
};

export default App;
