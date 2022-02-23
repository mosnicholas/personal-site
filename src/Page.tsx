import { Box, SlideFade } from '@chakra-ui/react';
import { Route } from 'wouter';

import About from 'routes/About';
import Connect from 'routes/Connect';
import Home from 'routes/Home';
import Investing from 'routes/Investing';
import NFTs from 'routes/NFTs';
import Photos from 'routes/Photos';

import Footer from './components/Footer';
import Header from './components/Header';

type PageProps = {
  renderPage: boolean;
};

const Page = ({ renderPage }: PageProps) => (
  <Box bgColor="blackAlpha.900" h="100vh">
    <SlideFade in={renderPage} offsetY={0}>
      <Header />
    </SlideFade>

    <Route path="/">
      <Home renderPage={renderPage} />
    </Route>

    <Route path="/about">
      <About renderPage={renderPage} />
    </Route>

    <Route path="/connect">
      <Connect renderPage={renderPage} />
    </Route>

    <Route path="/investing">
      <Investing renderPage={renderPage} />
    </Route>

    <Route path="/nfts">
      <NFTs renderPage={renderPage} />
    </Route>

    <Route path="/photos">
      <Photos renderPage={renderPage} />
    </Route>

    <SlideFade in={renderPage} offsetY={0}>
      <Footer />
    </SlideFade>
  </Box>
);

export default Page;
