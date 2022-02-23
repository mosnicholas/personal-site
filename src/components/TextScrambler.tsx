import { useEffect, useState } from 'react';

import { Heading } from '@chakra-ui/react';

import useScrambledText from 'hooks/useScrambledText';
import generateGlitchAnimation from 'utils/generateGlitchAnimation';

type TextScramblerProps = {
  text: string;
  callback: () => void;
};

const TextScrambler = ({ text, callback }: TextScramblerProps) => {
  const scrambledText = useScrambledText(text);
  const [renderedText, setRenderedText] = useState<null | string>(null);
  const [animProps, setAnimProps] = useState({});

  useEffect(() => {
    if (scrambledText === text) {
      setTimeout(() => {
        setRenderedText('nimo');
        setTimeout(
          () => setAnimProps(() => generateGlitchAnimation('nimo')),
          250,
        );
        // setTimeout(() => {
        //   setRenderedText('nimo.eth');
        //   setAnimProps(() => generateGlitchAnimation('nimo.eth'));
        // }, 1500);
        setTimeout(() => {
          setAnimProps(() => ({}));
          callback();
        }, 1500);
      }, 750);
    }
  }, [scrambledText, text]);

  return <Heading {...animProps}>{renderedText ?? scrambledText}</Heading>;
};

export default TextScrambler;
