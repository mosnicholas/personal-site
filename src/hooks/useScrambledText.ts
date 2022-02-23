import { useEffect, useRef, useState } from 'react';

import { getNewText, getRandomString } from 'utils/textScramble';

const useScrambledText = (text: string) => {
  const [scrambledText, setScrambledText] = useState('');
  const [count, setCount] = useState(0);
  const scrambledTextRef = useRef('');
  const countRef = useRef(0);
  let timeout: ReturnType<typeof setTimeout>;

  const updateText = () => {
    clearTimeout(timeout);

    const newText = getNewText(
      countRef.current,
      scrambledTextRef.current,
      text,
    );
    setScrambledText(newText);

    if (newText !== text) {
      setCount((c) => c + 1);
      timeout = setTimeout(updateText, 50);
    }
  };

  useEffect(() => {
    scrambledTextRef.current = scrambledText;
  }, [scrambledText]);

  useEffect(() => {
    countRef.current = count;
  }, [count]);

  useEffect(() => {
    setScrambledText(() => getRandomString(text.length));
    updateText();
    return () => clearTimeout(timeout);
  }, [text]);

  return scrambledText;
};

export default useScrambledText;
