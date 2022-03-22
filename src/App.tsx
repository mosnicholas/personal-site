import { useState } from 'react';

import { Center, ScaleFade, useDisclosure } from '@chakra-ui/react';
import { KBarProvider } from 'kbar';
import { useRoute } from 'wouter';

import KBarSearchBar from 'components/KBarSearch';
import useKBarActions from 'hooks/useKBarActions';

import TextScrambler from './components/TextScrambler';
import Page from './Page';

const App = () => {
  const actions = useKBarActions();
  const [isHome] = useRoute('/');

  /**
   * We use two different keys here to create the fade out effect before
   * rendering the routes
   */
  const [isLoading, setIsLoading] = useState(isHome);
  const [renderRoutes, setRenderRoutes] = useState(!isHome);
  const { isOpen, onOpen, onClose } = useDisclosure();

  return renderRoutes ? (
    <KBarProvider
      actions={actions}
      options={{
        callbacks: {
          onOpen,
          onClose,
          onSelectAction: onClose,
        },
        disableDocumentLock: true,
      }}
    >
      <KBarSearchBar isOpen={isOpen} />
      <Page />
    </KBarProvider>
  ) : (
    <Center h="100vh">
      <ScaleFade initialScale={isLoading ? 1 : 0} reverse in={isLoading}>
        <TextScrambler
          text="nicholas moschopoulos"
          callback={() => {
            setIsLoading(false);
            setTimeout(() => setRenderRoutes(true), 500);
          }}
        />
      </ScaleFade>
    </Center>
  );
};

export default App;
