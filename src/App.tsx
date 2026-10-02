import { lazy, Suspense, useEffect, useState } from 'react';

import StreamingText from './components/StreamingText';
import Tagline, { TAGLINE } from './components/Tagline';
import TerminalMode from './components/TerminalMode';
import TextScrambler from './components/TextScrambler';

// Loaded on demand, so the reading page never adds to the landing bundle
const ReadingPage = lazy(() => import('./components/reading/ReadingPage'));

const isTerminalUrl = () =>
  new URLSearchParams(window.location.search).get('mode') === 'terminal';

const isReadingUrl = () => /^\/reading\/?$/.test(window.location.pathname);

const Landing = () => {
  const [showNimo, setShowNimo] = useState(false);
  const [streamingComplete, setStreamingComplete] = useState(false);
  const [showHint, setShowHint] = useState(false);

  useEffect(() => {
    const timeout = setTimeout(() => setShowHint(true), 3000);
    return () => clearTimeout(timeout);
  }, []);

  useEffect(() => {
    // ~ or t opens terminal mode (ignore browser shortcuts like Cmd+T)
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === '~' || e.key === 't') {
        window.location.href = '?mode=terminal';
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="app">
      <div className="content">
        {showNimo ? (
          <>
            <h1 className="nimo-glitch">nimo</h1>
            {streamingComplete ? (
              <Tagline className="subtitle" />
            ) : (
              <StreamingText
                text={TAGLINE}
                speed={40}
                className="subtitle"
                onComplete={() => setStreamingComplete(true)}
              />
            )}
          </>
        ) : (
          <TextScrambler
            text="nicholas moschopoulos"
            holdMs={1000}
            onComplete={() => setShowNimo(true)}
          />
        )}
      </div>
      {showHint && (
        <a className="terminal-hint" href="?mode=terminal">
          <span className="hint-keyboard">
            Press <span className="key-hint">~</span> for terminal mode
          </span>
          <span className="hint-touch">
            Tap for <span className="key-hint">terminal mode</span>
          </span>
        </a>
      )}
    </div>
  );
};

const App = () => {
  if (isReadingUrl()) {
    return (
      <Suspense fallback={null}>
        <ReadingPage />
      </Suspense>
    );
  }
  return isTerminalUrl() ? <TerminalMode /> : <Landing />;
};

export default App;
