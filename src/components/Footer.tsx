import { Flex, HStack, Link } from '@chakra-ui/react';

const Footer = () => (
  <Flex as="footer" align="center" justify="center" wrap="wrap" w="100%" py={4}>
    <HStack spacing={6} fontSize="sm">
      <Link isExternal colorScheme="gray" href="https://twitter.com/__nimo23">
        twitter
      </Link>
      <Link
        isExternal
        colorScheme="gray"
        href="https://www.instagram.com/adventuresofmos"
      >
        instagram
      </Link>
      <Link
        isExternal
        colorScheme="gray"
        href="https://www.linkedin.com/in/nimo-1/"
      >
        linkedin
      </Link>
      <Link
        isExternal
        colorScheme="gray"
        href="https://github.com/mosnicholas/"
      >
        github
      </Link>
      <Link
        isExternal
        colorScheme="gray"
        href="mailto:nico.moschopoulos@gmail.com?subject=Hey!"
      >
        email
      </Link>
    </HStack>
  </Flex>
);

export default Footer;
