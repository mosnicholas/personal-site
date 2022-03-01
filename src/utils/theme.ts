import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  fonts: {
    body: 'Roboto, sans serif',
  },
  initialColorMode: 'dark',
  useSystemColorMode: false,
  styles: {
    global: {
      body: {
        color: 'gray.400',
        letterSpacing: '1.2px',
        backgroundColor: 'blackAlpha.900',
      },
      space: {
        px: '4px',
      },
    },
  },
});

export default theme;
