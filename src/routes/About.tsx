import { Center, Flex, Heading } from '@chakra-ui/react';

const About = () => (
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
    </Flex>
  </Center>
);

export default About;
