import * as React from 'react';

import { ChakraProvider } from '@chakra-ui/react';
import ReactDOM from 'react-dom';

import '@fontsource/roboto-mono';
import '@fontsource/roboto';

import App from './App';
import reportWebVitals from './reportWebVitals';
import theme from './utils/theme';

ReactDOM.render(
  <React.StrictMode>
    <ChakraProvider theme={theme}>
      <App />
    </ChakraProvider>
  </React.StrictMode>,
  document.getElementById('root'),
);

// If you want to start measuring performance in your app, pass a function
// to log results (for example: reportWebVitals(console.log))
// or send to an analytics endpoint. Learn more: https://bit.ly/CRA-vitals
reportWebVitals();
