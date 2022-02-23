import { extendTheme } from '@chakra-ui/react';

const theme = extendTheme({
  fonts: {
    heading: 'Roboto Mono, sans serif',
    body: 'Roboto, sans serif',
  },
  initialColorMode: 'dark',
  useSystemColorMode: false,
  styles: {
    global: {
      body: {
        color: 'gray.400',
        letterSpacing: '1.2px',
      },
      space: {
        px: '4px',
      },
    },
  },
});

export default theme;
