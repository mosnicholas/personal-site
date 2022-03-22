import { ReactNode } from 'react';

import { Box, Center, Heading, VStack } from '@chakra-ui/react';

type InvestingSectionProps = {
  children: ReactNode;
  heading: string;
  id: string;
};

const InvestingSection = ({ children, heading, id }: InvestingSectionProps) => (
  <Box scrollSnapAlign="start" h={{ base: '500px', md: '400px' }} id={id}>
    <Center h="100%">
      <VStack alignItems="flex-start" spacing={4}>
        <Heading>{heading}</Heading>
        {children}
      </VStack>
    </Center>
  </Box>
);

export default InvestingSection;
