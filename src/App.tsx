import { useState } from 'react';

import { Center, ScaleFade } from '@chakra-ui/react';

import TextScrambler from './components/TextScrambler';
import Page from './Page';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [renderPage, setRenderPage] = useState(false);

  return (
    <>
      {!renderPage && (
        <Center h="100vh" bgColor="blackAlpha.900" color="gray.50">
          <ScaleFade initialScale={isLoading ? 1 : 0} reverse in={isLoading}>
            <TextScrambler
              text="nicholas moschopoulos"
              callback={() => {
                setIsLoading(false);
                setTimeout(() => setRenderPage(true), 500);
              }}
            />
          </ScaleFade>
        </Center>
      )}

      <Page renderPage={renderPage} />
    </>
  );
};

export default App;
