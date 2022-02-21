import { useEffect, useState } from 'react';

import { Heading } from '@chakra-ui/react';

import useScrambledText from './hooks/useScrambledText';
import glitchAnimation from './utils/glitchAnimation';

type TextScramblerProps = {
  text: string;
};

function TextScrambler({ text }: TextScramblerProps) {
  const scrambledText = useScrambledText(text);
  const [renderedText, setRenderedText] = useState<null | string>(null);
  const [animProps, setAnimProps] = useState({});

  useEffect(() => {
    if (scrambledText === text) {
      setTimeout(() => setAnimProps(() => glitchAnimation), 1000);
      setTimeout(() => {
        setRenderedText('nimo');
        setAnimProps(() => ({
          ...glitchAnimation,
          _before: {
            // eslint-disable-next-line
            ...glitchAnimation._before,
            content: "'nimo'",
          },
          _after: {
            // eslint-disable-next-line
            ...glitchAnimation._after,
            content: "'nimo'",
          },
        }));
      }, 5000);
    }
  }, [scrambledText, text]);

  return <Heading {...animProps}>{renderedText ?? scrambledText}</Heading>;
}

export default TextScrambler;
