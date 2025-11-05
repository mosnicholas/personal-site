import { useState, useEffect } from 'react';

import ChatInterface from './ChatInterface';

type BootStep = 'initializing' | 'loading' | 'profile' | 'running' | 'chat';

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

const TerminalMode = () => {
  const [bootStep, setBootStep] = useState<BootStep>('initializing');
  const [lines, setLines] = useState<string[]>([]);
  const [showSubtitle, setShowSubtitle] = useState(false);

  useEffect(() => {
    const sequence = async () => {
      // Step 1: INITIALIZING...
      await sleep(300);
      setLines(['> INITIALIZING...']);
      await sleep(800);

      // Step 2: LOADING PROFILE...
      setBootStep('loading');
      setLines((prev) => [...prev, '> LOADING PROFILE...']);
      await sleep(1000);

      // Step 3: Show profile info
      setBootStep('profile');
      setShowSubtitle(true);
      await sleep(1200);

      // Step 4: RUNNING NIMO_CHAT.EXE...
      setBootStep('running');
      setLines((prev) => [...prev, '> RUNNING NIMO_CHAT.EXE...']);
      await sleep(1000);

      // Step 5: Show chat interface
      setBootStep('chat');
    };

    sequence();
  }, []);

  const renderSubtitle = () => (
    <div className="boot-line subtitle-line">
      adventurer, cook, and founder of{' '}
      <a
        href="https://myjunior.ai"
        target="_blank"
        rel="noopener noreferrer"
        className="terminal-link"
      >
        Junior
      </a>
    </div>
  );

  return (
    <div className="terminal-mode">
      <div className="terminal-content">
        {bootStep !== 'chat' ? (
          <div className="boot-sequence">
            {lines.map((line, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className="boot-line">
                {line}
              </div>
            ))}
            {showSubtitle && renderSubtitle()}
            <div className="cursor-blink">_</div>
          </div>
        ) : (
          <>
            <div className="boot-history">
              {lines.map((line, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={index} className="boot-line">
                  {line}
                </div>
              ))}
              {renderSubtitle()}
            </div>
            <ChatInterface />
          </>
        )}
      </div>
    </div>
  );
};

export default TerminalMode;
