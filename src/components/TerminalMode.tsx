import { useEffect, useState } from 'react';

import ChatInterface from './ChatInterface';
import Tagline from './Tagline';

// Each stage reveals one more piece of the boot log; the last one opens the chat.
const STAGE_DELAYS_MS = [300, 800, 1000, 1200, 1000];
const CHAT_STAGE = STAGE_DELAYS_MS.length;

const TerminalMode = () => {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    let at = 0;
    const timeouts = STAGE_DELAYS_MS.map((delay, i) => {
      at += delay;
      return setTimeout(() => setStage(i + 1), at);
    });
    return () => timeouts.forEach(clearTimeout);
  }, []);

  const bootLog = (
    <>
      {stage >= 1 && <div className="boot-line">&gt; INITIALIZING...</div>}
      {stage >= 2 && <div className="boot-line">&gt; LOADING PROFILE...</div>}
      {stage >= 3 && (
        <Tagline
          className="boot-line subtitle-line"
          linkClassName="terminal-link"
        />
      )}
      {stage >= 4 && (
        <div className="boot-line">&gt; RUNNING NIMO_CHAT.EXE...</div>
      )}
    </>
  );

  return (
    <div className="terminal-mode">
      <div className="terminal-content">
        {stage >= CHAT_STAGE ? (
          <>
            <div className="boot-history">{bootLog}</div>
            <ChatInterface />
          </>
        ) : (
          <div className="boot-sequence">
            {bootLog}
            <div className="cursor-blink">_</div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TerminalMode;
