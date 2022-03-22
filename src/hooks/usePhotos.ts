import { useQuery } from 'react-query';

import { IG_HANDLE } from 'utils/consts';
import { IgPhoto } from 'utils/types';

type IgPhotoResponse = {
  photos: IgPhoto[];
};

const usePhotos = () => {
  const query = useQuery<IgPhotoResponse, Error>('ALCHEMY_NFTS', () => {
    const fetchResponse: Promise<IgPhotoResponse> = fetch(
      `https://www.instagram.com/${IG_HANDLE}`,
    ).then(async (val) => {
      const jsonBody = await val.json();
      return jsonBody?.graphql?.user?.edge_owner_to_timeline_media?.edges?.map(
        ({ node }: { node: Record<string, any> }) => ({
          displayUrl: node?.display_url,
          caption: node?.edge_media_to_caption?.edges?.[0]?.node?.text,
          mediaPreview: node?.media_preview,
        }),
      );
    });

    return fetchResponse;
  });

  return query;
};

export default usePhotos;
