import { useContext } from 'react';

import { Box, Modal, ModalContent, ModalOverlay } from '@chakra-ui/react';
import {
  KBarAnimator,
  KBarResults,
  KBarSearch,
  useMatches,
  VisualState,
} from 'kbar';
import { KBarContext } from 'kbar/lib/KBarContextProvider';

import ResultItem from './ResultItem';

type KBarSearchBarProps = {
  isOpen: boolean;
};

const KBarSearchBar = ({ isOpen }: KBarSearchBarProps) => {
  const { results } = useMatches();
  const kbarContext = useContext(KBarContext);

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => {
        if (kbarContext.getState().visualState !== 'hidden') {
          kbarContext.options.callbacks?.onClose?.();
          kbarContext.query.setVisualState(VisualState.hidden);
        }
      }}
      size="lg"
      isCentered
    >
      <ModalOverlay />
      <ModalContent>
        <Box
          as={KBarAnimator}
          maxW="600px"
          w="100%"
          rounded="md"
          overflow="hidden"
        >
          <Box
            as={KBarSearch}
            w="100%"
            outline="none"
            border="none"
            fontSize="md"
            boxSizing="border-box"
            px={4}
            py={3}
            bgColor="transparent"
          />
          <KBarResults
            items={results}
            onRender={({ item, active }) => (
              <ResultItem item={item} active={active} />
            )}
          />
        </Box>
      </ModalContent>
    </Modal>
  );
};
export default KBarSearchBar;
