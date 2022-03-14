import { extendTheme } from '@chakra-ui/react';

import components from './components';
import semanticTokens from './semanticTokens';
import styles from './styles';

const theme = extendTheme({
  config: {
    initialColorMode: 'dark',
    useSystemColorMode: false,
  },
  styles,
  semanticTokens,
  components,
});

export default theme;
