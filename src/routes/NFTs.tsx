import ImageGrid from 'components/Layout/ImageGrid';
import NFTCard, { NFTLoadingCard } from 'components/NFTCard';
import useNFTs from 'hooks/useNFTs';
import { NFT } from 'utils/types';

const LOADING_CARDS = Array(3).fill(0).map(Math.random);

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

const NFTs = () => {
  const { data, isLoading } = useNFTs();

  return (
    <ImageGrid>
      <NFTCards isLoading={isLoading} nfts={data?.ownedNfts} />
    </ImageGrid>
  );
};

export default NFTs;
