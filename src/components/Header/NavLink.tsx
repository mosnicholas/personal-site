import { Box } from '@chakra-ui/react';
import { Link } from 'wouter';

type NavLinkProps = {
  title: string;
  href: string;
};

const NavLink = ({ title, href }: NavLinkProps) => (
  <Box
    as={Link}
    href={href}
    color="gray.400"
    fontWeight="light"
    textTransform="uppercase"
    fontSize="xs"
    letterSpacing="1.2px"
    py={2}
    px={4}
    borderRadius={2}
    transition="all 0.25s ease-in-out"
    _hover={{
      bgColor: 'gray.700',
      color: 'gray.50',
    }}
  >
    {title}
  </Box>
);

export default NavLink;
