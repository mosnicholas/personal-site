import { useEffect, useState } from 'react';

import { getNewText, getRandomString } from '../utils/textScramble';

const TICK_MS = 50;

const useScrambledText = (text: string) => {
  const [scrambledText, setScrambledText] = useState(() =>
    getRandomString(text.length),
  );

  useEffect(() => {
    let current = '';
    let count = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const tick = () => {
      current = getNewText(count, current, text);
      count += 1;
      setScrambledText(current);

      if (current !== text) {
        timeout = setTimeout(tick, TICK_MS);
      }
    };

    timeout = setTimeout(tick, TICK_MS);
    return () => clearTimeout(timeout);
  }, [text]);

  return scrambledText;
};

export default useScrambledText;
