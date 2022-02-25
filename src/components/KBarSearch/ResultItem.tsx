import { Box, forwardRef, HStack, Text } from '@chakra-ui/react';
import { ActionImpl } from 'kbar';

type ResultItemProps = {
  item: ActionImpl | string;
  active: boolean;
};
const ResultItem = forwardRef(({ item, active }: ResultItemProps, ref) => {
  if (typeof item === 'string') {
    return (
      <Box
        py={4}
        px={4}
        fontSize="xs"
        textTransform="uppercase"
        color="blackAlpha.600"
      >
        {item}
      </Box>
    );
  }
  return (
    <HStack
      ref={ref}
      py={3}
      px={4}
      bgColor={active ? 'blackAlpha.50' : 'transparent'}
      borderLeftWidth={active ? '2px' : 0}
      borderLeftColor="alpha.500"
      color={active ? 'alpha.500' : 'initial'}
      cursor="pointer"
      alignItems="center"
    >
      <Text>{item.name}</Text>
    </HStack>
  );
});
export default ResultItem;
