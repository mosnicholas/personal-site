import React, { useEffect, useState } from 'react';

import { Link, SlideFade, Text, VStack } from '@chakra-ui/react';

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
        }, 250);
      }, 1250);
      setTimeout(() => setTextIndex(textIndex + 1), 1500);
      setText(TEXTS[textIndex % TEXTS.length]);
    } else {
      setText('Hit cmd + k to get going');
    }
  }, [textIndex]);

  return (
    <VStack
      spacing={2}
      w="100%"
      align="flex-start"
      mt={4}
      fontSize="lg"
      color="gray.400"
    >
      <SlideFade in={showText} offsetY={-10}>
        {text}
      </SlideFade>
    </VStack>
  );
};

export default TextCycler;
