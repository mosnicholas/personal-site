import { useContext } from 'react';

import { Box, Flex, Heading, HStack, Icon, IconButton } from '@chakra-ui/react';
import { KBarContext } from 'kbar';
import { GiHamburgerMenu } from 'react-icons/gi';
import { Link } from 'wouter';

import NavLink from './NavLink';

const Header = () => {
  const kbarContext = useContext(KBarContext);
  return (
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
      <HStack
        spacing={0}
        overflowX="scroll"
        display={{ base: 'none', md: 'flex' }}
      >
        <NavLink href="/about" title="about" />
        <NavLink href="/connect" title="connect" />
        <NavLink href="/investing" title="investing" />
        <NavLink href="/photos" title="photos" />
      </HStack>
      <IconButton
        display={{ md: 'none' }}
        icon={<Icon as={GiHamburgerMenu} />}
        aria-label="menu"
        variant="ghost"
        onClick={() => {
          kbarContext.options.callbacks?.onOpen?.();
        }}
      />
    </Flex>
  );
};

export default Header;
