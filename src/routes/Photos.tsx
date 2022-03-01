import { Image, Skeleton } from '@chakra-ui/react';

import ImageGrid from 'components/Layout/ImageGrid';

const Photos = () => (
  <ImageGrid>
    <Image fallback={<Skeleton w={255} h={255} rounded="sm" />} />
  </ImageGrid>
);

export default Photos;
