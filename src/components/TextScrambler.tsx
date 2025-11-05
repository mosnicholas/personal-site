import { useEffect } from 'react';

import useScrambledText from 'hooks/useScrambledText';

type TextScramblerProps = {
  text: string;
  callback: () => void;
  className?: string;
};

const TextScrambler = ({
  text,
  callback,
  className = 'scrambler',
}: TextScramblerProps) => {
  const scrambledText = useScrambledText(text);

  useEffect(() => {
    if (scrambledText === text) {
      setTimeout(() => {
        callback();
      }, 500);
    }
  }, [scrambledText, text, callback]);

  return <h1 className={className}>{scrambledText}</h1>;
};

TextScrambler.defaultProps = {
  className: 'scrambler',
};

export default TextScrambler;
