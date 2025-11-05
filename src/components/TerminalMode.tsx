import { useState, useEffect, useRef } from 'react';

import ChatInterface, { ChatInterfaceHandle } from './ChatInterface';

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
  const chatInterfaceRef = useRef<ChatInterfaceHandle>(null);

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

  useEffect(() => {
    // Listen for keydown events anywhere in the terminal
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only focus if we're in chat mode and it's a printable character
      if (bootStep === 'chat' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Focus the input for any printable key
        if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
          chatInterfaceRef.current?.focusInput();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [bootStep]);

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
              <div key={index}>
                <div className="boot-line">{line}</div>
                {index === 1 && showSubtitle && renderSubtitle()}
              </div>
            ))}
            <div className="cursor-blink">_</div>
          </div>
        ) : (
          <>
            <div className="boot-history">
              {lines.map((line, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <div key={index}>
                  <div className="boot-line">{line}</div>
                  {index === 1 && renderSubtitle()}
                </div>
              ))}
            </div>
            <ChatInterface ref={chatInterfaceRef} />
          </>
        )}
      </div>
    </div>
  );
};

export default TerminalMode;
