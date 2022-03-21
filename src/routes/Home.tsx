import { GridItem, Heading, Image, SimpleGrid, VStack } from '@chakra-ui/react';

import me from 'assets/me.jpg';
import TextCycler from 'components/TextCycler';

const Home = () => (
  <SimpleGrid columns={{ base: 1, md: 3 }} px={10} gap={2}>
    <GridItem colSpan={2} d="flex" alignSelf="center">
      <VStack alignItems="flex-start">
        <Heading fontFamily="Roboto" color="headerColor">
          Hey, I&apos;m Nico.
        </Heading>
        <TextCycler />
      </VStack>
    </GridItem>
    <GridItem rowStart={{ base: 1, md: 'auto' }}>
      <Image src={me} rounded="full" w={{ base: 48, md: 256 }} />
    </GridItem>
  </SimpleGrid>
);

export default Home;
