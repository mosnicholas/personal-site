import { VStack, Image, Skeleton, Text } from '@chakra-ui/react';

import { NFT } from 'utils/types';

type NFTCardProps = {
  nft: NFT;
};

const IMAGE_SIZE = 255;

const getNFTImageUrl = (imageUrl: string) => {
  if (imageUrl.startsWith('ipfs://')) {
    return imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }

  return imageUrl;
};

const NFTLoadingCard = () => (
  <Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />
);

const NFTCard = ({ nft }: NFTCardProps) => (
  <VStack alignItems={{ base: 'center', md: 'flex-start' }}>
    <Image
      fallback={<Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />}
      src={getNFTImageUrl(nft.metadata.image)}
      w={IMAGE_SIZE}
      h={IMAGE_SIZE}
    />

    <Text fontSize="sm">{nft.title}</Text>
  </VStack>
);

export { NFTLoadingCard };
export default NFTCard;
