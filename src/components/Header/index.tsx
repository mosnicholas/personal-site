import { Box, Flex, Heading, HStack } from '@chakra-ui/react';
import { Link } from 'wouter';

import NavLink from './NavLink';

const Header = () => (
  <Flex
    as="nav"
    align="center"
    justify="space-between"
    wrap="wrap"
    w="100%"
    py={4}
    px={8}
    position="sticky"
    bgColor="gray.800"
    boxShadow="xl"
  >
    <Heading>
      <Box as={Link} href="/" color="headerColor">
        n
      </Box>
    </Heading>
    <HStack spacing={0} overflowX="scroll">
      <NavLink href="/about" title="about" />
      <NavLink href="/connect" title="connect" />
      <NavLink href="/investing" title="investing" />
      <NavLink href="/photos" title="photos" />
    </HStack>
  </Flex>
);

export default Header;
