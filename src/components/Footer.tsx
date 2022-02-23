import { Flex, HStack, Link } from '@chakra-ui/react';

const Footer = () => (
  <Flex
    as="footer"
    align="center"
    justify="center"
    wrap="wrap"
    w="100%"
    py={4}
    px={8}
    position="fixed"
    bottom={0}
  >
    <HStack spacing={6} fontSize="sm">
      <Link isExternal href="https://twitter.com/__nimo23">
        twitter
      </Link>
      <Link isExternal href="https://www.instagram.com/adventuresofmos">
        instagram
      </Link>
      <Link isExternal href="https://www.linkedin.com/in/nimo-1/">
        linkedin
      </Link>
      <Link isExternal href="https://github.com/mosnicholas/">
        github
      </Link>
    </HStack>
  </Flex>
);

export default Footer;