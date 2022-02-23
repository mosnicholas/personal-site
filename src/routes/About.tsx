import { Center, Flex, Heading, SlideFade } from '@chakra-ui/react';

import TextCycler from 'components/TextCycler';

type AboutProps = {
  renderPage: boolean;
};

const About = ({ renderPage }: AboutProps) => (
  <SlideFade in={renderPage} style={{ height: '100%' }}>
    <Center h="100%">
      <Flex
        py={5}
        px={{ base: 10, md: 'unset' }}
        maxW="800px"
        w="100%"
        flexDir="column"
      >
        <Heading fontFamily="Roboto" color="gray.50">
          about
        </Heading>
        <TextCycler />
      </Flex>
    </Center>
  </SlideFade>
);

export default About;
