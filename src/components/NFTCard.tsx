import { VStack, Image, Skeleton, Text, Link } from '@chakra-ui/react';
import { BigNumber } from 'bignumber.js';
import { Parallax } from 'react-scroll-parallax';

import { NFT } from 'utils/types';

type NFTCardProps = {
  nft: NFT;
};

const IMAGE_SIZE = 255;
const OPEN_SEA_BASE = 'https://opensea.io/assets';

const getOpenSeaURL = (nft: NFT) => {
  const tokenId = new BigNumber(nft.id.tokenId).toNumber();
  const url = `${OPEN_SEA_BASE}/${nft.contract.address}/${tokenId}`;
  return url;
};

const getNFTImageUrl = (imageUrl: string) => {
  if (imageUrl.startsWith('ipfs://')) {
    return imageUrl.replace('ipfs://', 'https://ipfs.io/ipfs/');
  }

  return imageUrl;
};

const NFTLoadingCard = () => (
  <Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />
);

const rotateDeg = () => Math.random() * 180;
const translateX = () => 50 + Math.random() * 180;

const NFTCard = ({ nft }: NFTCardProps) => (
  <Parallax
    translateX={[`${translateX()}px`, '0px']}
    scale={[0.75, 1]}
    rotate={[-rotateDeg(), rotateDeg()]}
    easing="easeInQuad"
  >
    <Link href={getOpenSeaURL(nft)} isExternal variant="gray">
      <VStack alignItems={{ base: 'center', md: 'flex-start' }}>
        <Image
          fallback={<Skeleton w={IMAGE_SIZE} h={IMAGE_SIZE} rounded="sm" />}
          src={getNFTImageUrl(nft.metadata.image)}
          w={IMAGE_SIZE}
          h={IMAGE_SIZE}
        />

        <Text fontSize="sm">{nft.title}</Text>
      </VStack>
    </Link>
  </Parallax>
);

export { NFTLoadingCard };
export default NFTCard;
