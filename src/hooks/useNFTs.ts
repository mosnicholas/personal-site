import { useQuery } from 'react-query';

import { BASE_ALCHEMY_URL, MY_ETH_ADDRESS } from 'utils/consts';
import { NFT } from 'utils/types';

type NFTResponse = {
  ownedNfts: NFT[];
  totalCount: number;
};

const ALCHEMY_URL = `${BASE_ALCHEMY_URL}?owner=${MY_ETH_ADDRESS}&withMetadata=true`;

const useNFTs = () => {
  const query = useQuery<NFTResponse, Error>('ALCHEMY_NFTS', () => {
    const fetchResponse: Promise<NFTResponse> = fetch(ALCHEMY_URL).then(
      (val) => {
        const jsonBody = val.json();
        return jsonBody;
      },
    );

    return fetchResponse;
  });

  return query;
};

export default useNFTs;
