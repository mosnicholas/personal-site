import { useState } from 'react';

import {
  Button,
  GridItem,
  Heading,
  Icon,
  Link,
  SimpleGrid,
  Text,
  VStack,
} from '@chakra-ui/react';
import { PopupModal } from 'react-calendly';
import { MdOutlineAlternateEmail } from 'react-icons/md';

const Connect = () => {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <SimpleGrid columns={{ base: 1, md: 3 }} pt={{ base: 20, md: 0 }}>
      <GridItem colSpan={1} alignSelf="center">
        <Icon as={MdOutlineAlternateEmail} boxSize={20} />
      </GridItem>
      <GridItem colSpan={2} py={20}>
        <VStack alignItems="flex-start" w="100%">
          <Heading fontSize="lg">
            I love meeting new people and discussing new ideas.
          </Heading>
          <Text>
            Schedule a 30 min chat with me
            <Button
              onClick={() => setIsOpen(true)}
              variant="link"
              colorScheme="orange"
              fontWeight="normal"
            >
              here
            </Button>
            , or send me an{' '}
            <Link
              colorScheme="orange"
              href="mailto:nico.moschopoulos@gmail.com?subject=Let's Chat!"
            >
              email
            </Link>{' '}
            to connect!
          </Text>
        </VStack>
      </GridItem>
      <PopupModal
        url="https://calendly.com/_nimo/30min"
        pageSettings={{
          hideGdprBanner: true,
          hideLandingPageDetails: true,
          hideEventTypeDetails: true,
        }}
        prefill={{}}
        onModalClose={() => setIsOpen(false)}
        open={isOpen}
        rootElement={document.getElementById('root') as HTMLElement}
      />
    </SimpleGrid>
  );
};

export default Connect;
