import { useState } from 'react';

import TextScrambler from './components/TextScrambler';

const App = () => {
  const [showNimo, setShowNimo] = useState(false);
  const [showSubtitle, setShowSubtitle] = useState(false);

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
            <h1 className="scrambler">nimo</h1>
            {!showSubtitle && (
              <TextScrambler
                text="adventurer, cook, and founder of Junior"
                callback={() => setShowSubtitle(true)}
                className="subtitle"
              />
            )}
            {showSubtitle && (
              <div className="subtitle visible">
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
