import React from 'react';

import { Box, Center, SimpleGrid } from '@chakra-ui/react';

type ImageGridProps = {
  children: React.ReactNode;
};

const ImageGrid = ({ children }: ImageGridProps) => (
  <Box py={20} overflowY="scroll" h="100%">
    <Center>
      <SimpleGrid columns={{ base: 1, md: 2, lg: 3, xl: 4 }} gap={10}>
        {children}
      </SimpleGrid>
    </Center>
  </Box>
);

export default ImageGrid;
