import { useEffect } from 'react';

import { Heading } from '@chakra-ui/react';

import useScrambledText from 'hooks/useScrambledText';

type TextScramblerProps = {
  text: string;
  callback: () => void;
};

const TextScrambler = ({ text, callback }: TextScramblerProps) => {
  const scrambledText = useScrambledText(text);

  useEffect(() => {
    if (scrambledText === text) {
      setTimeout(() => {
        callback();
      }, 500);
    }
  }, [scrambledText, text, callback]);

  return (
    <Heading fontFamily="Roboto Mono, sans serif" textAlign="center">
      {scrambledText}
    </Heading>
  );
};

export default TextScrambler;
