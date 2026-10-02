import { useEffect, useEffectEvent } from 'react';

import useScrambledText from '../hooks/useScrambledText';

type TextScramblerProps = {
  text: string;
  onComplete: () => void;
  /** How long the solved text stays on screen before `onComplete` fires. */
  holdMs?: number;
  className?: string;
};

const TextScrambler = ({
  text,
  onComplete,
  holdMs = 500,
  className = 'scrambler',
}: TextScramblerProps) => {
  const scrambledText = useScrambledText(text);
  const isSolved = scrambledText === text;
  const handleComplete = useEffectEvent(onComplete);

  useEffect(() => {
    if (!isSolved) return undefined;

    const timeout = setTimeout(() => handleComplete(), holdMs);
    return () => clearTimeout(timeout);
  }, [isSolved, holdMs]);

  return <h1 className={className}>{scrambledText}</h1>;
};

export default TextScrambler;
