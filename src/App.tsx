import { useState } from 'react';

import { Center, Link, ScaleFade, Text, VStack } from '@chakra-ui/react';

import TextScrambler from './components/TextScrambler';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(false);

  return (
    <Center h="100vh">
      <VStack spacing={4}>
        <ScaleFade initialScale={isLoading ? 1 : 0} reverse in={isLoading}>
          <TextScrambler
            text="nimo"
            callback={() => {
              setIsLoading(false);
              setTimeout(() => setShowSubtitle(true), 500);
            }}
          />
        </ScaleFade>
        {showSubtitle && (
          <ScaleFade initialScale={0.9} in={showSubtitle}>
            <Text fontSize="sm" color="gray.400" textAlign="center">
              adventurer, cook, and founder of{' '}
              <Link href="https://myjunior.ai" isExternal>
                Junior
              </Link>
            </Text>
          </ScaleFade>
        )}
      </VStack>
    </Center>
  );
};

export default App;
