import { forwardRef, HStack, Icon, Text } from '@chakra-ui/react';
import { ActionImpl } from 'kbar';

type ResultItemProps = {
  item: ActionImpl | string;
  active: boolean;
};

const ResultItem = forwardRef(({ item, active }: ResultItemProps, ref) => {
  if (typeof item === 'string') {
    return (
      <Text py={4} px={4} fontSize="xx-small" textTransform="uppercase">
        {item}
      </Text>
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
      color={active ? 'whiteAlpha.900' : 'whiteAlpha.500'}
      cursor="pointer"
      alignItems="center"
      spacing={1}
    >
      {/* eslint-disable-next-line */}
      <Icon as={item.icon as any} boxSize={6} />
      <Text>{item.name}</Text>
    </HStack>
  );
});
export default ResultItem;
