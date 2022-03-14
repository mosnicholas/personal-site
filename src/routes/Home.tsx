import { GridItem, Heading, Image, SimpleGrid, VStack } from '@chakra-ui/react';

import me from 'assets/me.jpg';
import TextCycler from 'components/TextCycler';

const Home = () => (
  <SimpleGrid columns={3}>
    <GridItem colSpan={2} d="flex" alignSelf="center">
      <VStack alignItems="flex-start">
        <Heading fontFamily="Roboto" color="headerColor">
          Hey, I&apos;m Nico.
        </Heading>
        <TextCycler />
      </VStack>
    </GridItem>
    <Image src={me} rounded="full" w={256} />
  </SimpleGrid>
);

export default Home;
