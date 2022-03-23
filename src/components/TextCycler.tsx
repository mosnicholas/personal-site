import React, { useEffect, useState } from 'react';

import { Flex, Link, SlideFade, Text } from '@chakra-ui/react';

const CYCLE_TIME = 1500;
const FADE_OUT_TIME = 250;
const SHOW_TEXT = CYCLE_TIME - FADE_OUT_TIME;

const TEXTS = [
  <Text>
    Software Engineer @{' '}
    <Link href="https://getjuice.com" isExternal>
      Creative Juice
    </Link>
  </Text>,
  <Text>
    Venture Fellow @{' '}
    <Link href="https://susaventures.com" isExternal>
      Susa Ventures
    </Link>
  </Text>,
  'Food lover',
  'Angel investor',
  'Amateur photographer',
];

const TextCycler = () => {
  const [textIndex, setTextIndex] = useState(-1);
  const [showText, setShowText] = useState(false);
  const [text, setText] = useState<string | React.ReactNode>('');

  useEffect(() => {
    if (textIndex < TEXTS.length) {
      setTimeout(() => {
        setShowText(false);
        setTimeout(() => {
          setShowText(true);
        }, FADE_OUT_TIME);
      }, SHOW_TEXT);
      setTimeout(() => setTextIndex(textIndex + 1), CYCLE_TIME);
      setText(TEXTS[textIndex % TEXTS.length]);
    } else {
      setText('Hit cmd + k to get going');
    }
  }, [textIndex]);

  return (
    <SlideFade in={showText} offsetY={-10}>
      <Flex fontSize="lg" color="gray.400" height={10}>
        {text}
      </Flex>
    </SlideFade>
  );
};

export default TextCycler;
