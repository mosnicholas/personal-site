import { useState } from 'react';

import { Center, ScaleFade, useDisclosure } from '@chakra-ui/react';
import { KBarProvider } from 'kbar';

import KBarSearchBar from 'components/KBarSearch';
import useKBarActions from 'hooks/useKBarActions';

import TextScrambler from './components/TextScrambler';
import Page from './Page';

const App = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [renderPage, setRenderPage] = useState(false);
  const actions = useKBarActions();
  const { isOpen, onOpen, onClose } = useDisclosure();

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

      <KBarProvider
        actions={actions}
        options={{
          callbacks: {
            onOpen,
            onClose,
            onSelectAction: onClose,
          },
        }}
      >
        <KBarSearchBar isOpen={isOpen} />
        <Page renderPage={renderPage} />
      </KBarProvider>
    </>
  );
};

export default App;
