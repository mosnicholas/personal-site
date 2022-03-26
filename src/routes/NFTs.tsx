import { Box } from '@chakra-ui/react';
import { ParallaxProvider } from 'react-scroll-parallax';

import NFTCard, { NFTLoadingCard } from 'components/NFTCard';
import useNFTs from 'hooks/useNFTs';

const LOADING_CARDS = Array(3).fill(0).map(Math.random);

const NFTs = () => {
  const { data, isLoading } = useNFTs();

  if (isLoading) {
    return (
      <>
        {LOADING_CARDS.map((randId) => (
          <NFTLoadingCard key={randId} />
        ))}
      </>
    );
  }

  return (
    <Box pb="255px">
      <ParallaxProvider>
        {data?.ownedNfts?.map((nft) => (
          <NFTCard
            key={`${nft.contract.address}/${nft.id.tokenId}`}
            nft={nft}
          />
        ))}
      </ParallaxProvider>
    </Box>
  );
};

export default NFTs;
