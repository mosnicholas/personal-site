import { VStack, Image, Skeleton, Text, Box } from '@chakra-ui/react';

import { NFT } from 'utils/types';

type NFTCardProps = {
  nft: NFT;
};

const IMAGE_SIZE = 255;

const NFTLoadingCard = () => (
  <Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />
);

const NFTCard = ({ nft }: NFTCardProps) => (
  <VStack alignItems="flex-start" position="relative">
    <Image
      fallback={<Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />}
      src={nft.metadata.image}
      w={IMAGE_SIZE}
      h={IMAGE_SIZE}
    />
    <Box position="absolute" bottom={0} bgGradient="">
      <Text fontSize="sm">{nft.title}</Text>
    </Box>
  </VStack>
);

export { NFTLoadingCard };
export default NFTCard;
