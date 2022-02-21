import { Center } from '@chakra-ui/react';

import TextScrambler from './TextScrambler';

function App() {
  return (
    <Center h="100vh" bgColor="blackAlpha.900" color="gray.50">
      <TextScrambler text="nicholas moschopoulos" />
    </Center>
  );
}

export default App;
