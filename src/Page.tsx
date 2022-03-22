import { Flex, SlideFade } from '@chakra-ui/react';
import { Route } from 'wouter';

import RouteWrapper from 'components/Layout/RouteWrapper';
import About from 'routes/About';
import Connect from 'routes/Connect';
import Home from 'routes/Home';
import Investing from 'routes/Investing';
import NFTs from 'routes/NFTs';
import Photos from 'routes/Photos';

import Footer from './components/Footer';
import Header from './components/Header';

const Page = () => (
  <Flex
    minHeight="100vh"
    h="100%"
    flexDir="column"
    overflow="hidden"
    position="relative"
  >
    <SlideFade in offsetY={0}>
      <Header />
    </SlideFade>

    <RouteWrapper path="/">
      <Home />
    </RouteWrapper>

    <RouteWrapper path="/about">
      <About />
    </RouteWrapper>

    <RouteWrapper path="/connect">
      <Connect />
    </RouteWrapper>

    <Route path="/investing">
      <Investing />
    </Route>

    <RouteWrapper path="/nfts">
      <NFTs />
    </RouteWrapper>

    <RouteWrapper path="/photos">
      <Photos />
    </RouteWrapper>

    <SlideFade in offsetY={0}>
      <Footer />
    </SlideFade>
  </Flex>
);

export default Page;
