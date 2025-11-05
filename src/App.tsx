import { useState, useEffect } from 'react';

import StreamingText from './components/StreamingText';
import TerminalMode from './components/TerminalMode';
import TextScrambler from './components/TextScrambler';

const App = () => {
  const [showNimo, setShowNimo] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [isTerminalMode, setIsTerminalMode] = useState(false);

  useEffect(() => {
    // Check for mode=terminal query parameter
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'terminal') {
      setIsTerminalMode(true);
    }
  }, []);

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
    </div>
  );
};

export default App;
