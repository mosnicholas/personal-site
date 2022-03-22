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

export type IgPhoto = {
  displayUrl: string;
  caption: string;
  mediaPreview: string;
};
