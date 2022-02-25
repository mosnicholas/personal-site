export type NFT = {
  title: string;
  description: string;
  contract: {
    address: string;
  };
  id: {
    tokenId: string;
  };
  metadata: {
    image: string;
  };
};
