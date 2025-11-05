import { useState } from 'react';

import { Center, ScaleFade, Text, VStack } from '@chakra-ui/react';

import TextScrambler from './components/TextScrambler';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [showSubtitle, setShowSubtitle] = useState(false);

  return (
    <Center h="100vh">
      <VStack spacing={4}>
        <ScaleFade initialScale={isLoading ? 1 : 0} reverse in={isLoading}>
          <TextScrambler
            text="nicholas moschopoulos"
            callback={() => {
              setIsLoading(false);
              setTimeout(() => setShowSubtitle(true), 500);
            }}
          />
        </ScaleFade>
        {showSubtitle && (
          <ScaleFade initialScale={0.9} in={showSubtitle}>
            <Text fontSize="sm" color="gray.500" textAlign="center">
              adventurer, cook, and founder of myjunior.ai
            </Text>
          </ScaleFade>
        )}
      </VStack>
    </Center>
  );
};

export default App;
