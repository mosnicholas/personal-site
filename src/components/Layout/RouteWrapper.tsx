import { ReactNode } from 'react';

import { Center, Flex, Fade } from '@chakra-ui/react';
import { Route, useRoute } from 'wouter';

type RouteWrapperProps = {
  children: ReactNode;
  path: string;
};

const RouteWrapper = ({ children, path }: RouteWrapperProps) => {
  const [isActive] = useRoute(path);

  return (
    <Route path={path}>
      <Center h="100%" flex={1}>
        <Flex
          px={{ base: 10, md: 'unset' }}
          maxW="800px"
          w="100%"
          flexDir="column"
          h="100%"
        >
          <Fade in={isActive}>{children}</Fade>
        </Flex>
      </Center>
    </Route>
  );
};

export default RouteWrapper;
