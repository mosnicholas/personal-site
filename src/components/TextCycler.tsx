import { useEffect, useState } from 'react';

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
  'Massive foodie',
  'Angel investor',
  'Photographer',
];

const TextCycler = () => {
  const [textIndex, setTextIndex] = useState(0);
  const [showText, setShowText] = useState(false);

  useEffect(() => {
    setTimeout(() => {
      setShowText(false);
      setTimeout(() => {
        setShowText(true);
      }, 250);
    }, 1250);
    setTimeout(() => setTextIndex(textIndex + 1), 1500);
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
        {TEXTS[textIndex % TEXTS.length]}
      </SlideFade>
    </VStack>
  );
};

export default TextCycler;
