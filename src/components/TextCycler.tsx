import React, { useEffect, useState } from 'react';

import { Flex, Link, SlideFade, Text } from '@chakra-ui/react';

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
    const timeouts: Array<ReturnType<typeof setTimeout>> = [];
    if (textIndex < TEXTS.length) {
      const t = setTimeout(() => {
        setShowText(false);
        const t1 = setTimeout(() => {
          setShowText(true);
        }, 150);
        timeouts.push(t1);
      }, 1250);
      timeouts.push(t);
      const t3 = setTimeout(() => setTextIndex(textIndex + 1), 1500);
      timeouts.push(t3);
      setText(TEXTS[textIndex % TEXTS.length]);
    } else {
      setText('Hit cmd + k to get going');
    }

    return () => timeouts.forEach((t) => clearTimeout(t));
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
