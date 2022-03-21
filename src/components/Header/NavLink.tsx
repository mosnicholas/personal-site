import { Box } from '@chakra-ui/react';
import { Link, useRoute } from 'wouter';

type NavLinkProps = {
  title: string;
  href: string;
};

const NavLink = ({ title, href }: NavLinkProps) => {
  const [isActive] = useRoute(href);

  return (
    <Box
      as={Link}
      href={href}
      color={isActive ? 'whiteAlpha.900' : 'whiteAlpha.500'}
      fontWeight="light"
      textTransform="uppercase"
      fontSize="xs"
      letterSpacing="1.2px"
      py={2}
      px={4}
      borderRadius={2}
      position="relative"
      transition="all 0.25s ease-in-out"
      role="group"
      _hover={{
        bgColor: 'gray.700',
        color: 'gray.50',
      }}
    >
      <Box
        position="absolute"
        bottom={0}
        bgColor="whiteAlpha.900"
        px={isActive ? 4 : 0}
        _groupHover={{ px: 4 }}
        h="1px"
        transition="all 0.25s ease-in-out"
      />
      {title}
    </Box>
  );
};

export default NavLink;
