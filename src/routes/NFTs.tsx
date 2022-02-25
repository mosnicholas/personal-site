import { Box, Center, SimpleGrid, SlideFade } from '@chakra-ui/react';

import NFTCard, { NFTLoadingCard } from 'components/NFTCard';
import useNFTs from 'hooks/useNFTs';
import { NFT } from 'utils/types';

const LOADING_CARDS = Array(3).fill(0).map(Math.random);

type NFTsProps = {
  renderPage: boolean;
};

type NFTCardsProps = {
  isLoading: boolean;
  nfts: NFT[] | undefined;
};

const NFTCards = ({ isLoading, nfts }: NFTCardsProps) => {
  if (isLoading) {
    return (
      <>
        {LOADING_CARDS.map((randId) => (
          <NFTLoadingCard key={randId} />
        ))}
      </>
    );
  }

  if (nfts?.length) {
    return (
      <>
        {nfts.map((nft) => (
          <NFTCard
            key={`${nft.contract.address}/${nft.id.tokenId}`}
            nft={nft}
          />
        ))}
      </>
    );
  }

  return null;
};

const NFTs = ({ renderPage }: NFTsProps) => {
  const { data, isLoading } = useNFTs();

  return (
    <SlideFade in={renderPage} style={{ height: '100%' }}>
      <Box p={20} overflowY="scroll" h="100%">
        <Center>
          <SimpleGrid columns={{ base: 1, md: 2, lg: 3, xl: 4 }} gap={10}>
            <NFTCards isLoading={isLoading} nfts={data?.ownedNfts} />
          </SimpleGrid>
        </Center>
      </Box>
    </SlideFade>
  );
};

export default NFTs;
