import { Image, Skeleton } from '@chakra-ui/react';

import ImageGrid from 'components/Layout/ImageGrid';
import usePhotos from 'hooks/usePhotos';

const LOADING_CARDS = Array(3).fill(0).map(Math.random);

const Photos = () => {
  const { data, isLoading } = usePhotos();

  if (isLoading) {
    return (
      <ImageGrid>
        {LOADING_CARDS.map((randId) => (
          <Image
            key={randId}
            fallback={<Skeleton w={255} h={255} rounded="sm" />}
          />
        ))}
      </ImageGrid>
    );
  }

  return (
    <ImageGrid>
      {data?.photos.map((photo) => (
        <Image fallbackSrc={photo.mediaPreview} src={photo.displayUrl} />
      ))}
    </ImageGrid>
  );
};

export default Photos;
