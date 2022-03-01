import { Box, Fade, SlideFade } from '@chakra-ui/react';
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
  <Box minHeight="100vh" h="100%">
    <SlideFade in={renderPage} offsetY={0}>
      <Header />
    </SlideFade>

    <Fade in={renderPage}>
      <Route path="/">
        <Home />
      </Route>

      <Route path="/about">
        <About />
      </Route>

      <Route path="/connect">
        <Connect />
      </Route>

      <Route path="/investing">
        <Investing />
      </Route>

      <Route path="/nfts">
        <NFTs />
      </Route>

      <Route path="/photos">
        <Photos />
      </Route>
    </Fade>

    <SlideFade in={renderPage} offsetY={0}>
      <Footer />
    </SlideFade>
  </Box>
);

export default Page;
