import {
  Center,
  Fade,
  Flex,
  Link,
  ListItem,
  Text,
  UnorderedList,
} from '@chakra-ui/react';
import { useRoute, Link as WouterLink } from 'wouter';

import InvestingSection from 'components/InvestingSection';

const Investing = () => {
  const [isActive] = useRoute('/investing');

  return (
    <>
      <Center h="100%" flex={1}>
        <Flex
          px={{ base: 10, md: 'unset' }}
          pr={{ md: 20 }}
          maxW="800px"
          w="100%"
          flexDir="column"
          h="100%"
          overflowY="scroll"
          scrollSnapType="y mandatory"
          maxHeight={{ base: '500px', md: '400px' }}
          scrollBehavior="smooth"
          css={{
            '&::-webkit-scrollbar': {
              display: 'none',
              width: '0',
            },
            '&::-webkit-scrollbar-track': {
              width: '0',
            },
          }}
        >
          <Fade in={isActive}>
            <InvestingSection heading="Overview" id="overview">
              <Text>
                I like to invest in founders who have a strong belief about the
                way the world should be, who see things differently than the
                rest, and who find opportunity and creativity in that vision.
              </Text>
              <Text>
                I&apos;m sharing my investing theses here. If what you&apos;re
                building resonates with my thoughts, please{' '}
                <Link as={WouterLink} href="/connect">
                  reach out
                </Link>
                ! I will do my best to help you, anything from product feedback,
                to connecting you to the right people :) I learn by getting
                involved, and love to help out wherever I can!
              </Text>
              <Text display={{ base: 'initial', md: 'none' }}>
                Areas of interest: <Link href="#devtools">dev tools</Link>,{' '}
                <Link href="#climate">climate</Link>,{' '}
                <Link href="#fintech">fintech / crypto</Link>,{' '}
                <Link href="#food">food</Link>.
              </Text>
            </InvestingSection>

            <InvestingSection heading="Developer tools" id="devtools">
              <Text>
                As an engineer myself, I love to discover and use tools that
                help me and my team be more productive. This ranges all the way
                from tools like product management tools like{' '}
                <Link isExternal href="https://linear.app">
                  Linear
                </Link>{' '}
                to better git flows like{' '}
                <Link isExternal href="https://graphite.dev">
                  Graphite
                </Link>
                .
              </Text>
              <Text>
                I also believe that tools that replace functions like dev ops /
                simplify building things (e.g Retool) are crucial for fast
                moving, nimble startups. Companies like Vercel and Qovery have
                made dev ops roles obsolete, and allow us to build so much more
                quickly and efficiently than ever before.
              </Text>
            </InvestingSection>

            <InvestingSection heading="Climate change" id="climate">
              <Text>
                One of the most pressing problems of our (and the next)
                generation is climate change. We need better solutions across
                hardware of climate (transportation / energy manufacturing) to
                better software solutions.
              </Text>
              <Text>
                Particularly interesting to me is the intersection of climate
                and crypto. There are few tools as powerful as crypto to
                generate both the network effects and the trustless
                coordinatation that climate tech can leverage.
              </Text>
              <Text>
                E.g.{' '}
                <Link
                  isExternal
                  href="https://www.crusoeenergy.com/blog/3WxL5VNTNQVJ7EmNULryfI/bitcoin-as-battery"
                >
                  The Bitcoin battery.
                </Link>
              </Text>
            </InvestingSection>

            <InvestingSection heading="Fintech / Crypto" id="fintech">
              <Text>
                Having worked in fintech for the last 3 years, I have come to
                see how outdated so many of the financial systems we currently
                use are.
              </Text>
              <Text>
                Crypto is eating the world. We are on the cusp of one of the
                most fascinating technological revolutions since the internet.
                At scale, trustless, systems have the power to really change how
                we engage with each other, discover content, play games.
              </Text>
              <Text>
                Sample investments:{' '}
                <Link href="https://www.raincards.xyz" isExternal>
                  Rain Cards
                </Link>
                .
              </Text>
            </InvestingSection>

            <InvestingSection heading="Food & Hospitality" id="food">
              <Text>
                I started my career at AirBnb, worked at Noma, and care deeply
                about the inherent power of travel and food to bring people
                together. Eating healthy and experiencing the world has had a
                fundamental impact on who I am and what I consider to be right.
              </Text>
              <Text>
                For some food/restaurant tech investments, I am also working
                with the folks at{' '}
                <Link href="https://kitchenfund.com" isExternal>
                  Kitchen Fund
                </Link>{' '}
                to start thinking through their venture investing thesis and how
                it works with their current growth equity investments in
                restaurant groups.
              </Text>
              <Text>
                Sample investments:{' '}
                <Link href="https://www.jupiter.co" isExternal>
                  Juniper
                </Link>{' '}
                (food x creator economy),{' '}
                <Link href="https://akua.co" isExternal>
                  Akua
                </Link>
                .
              </Text>
            </InvestingSection>
          </Fade>
        </Flex>
      </Center>

      <Flex
        position="absolute"
        flexDirection="column"
        textAlign="right"
        margin="auto"
        justify="center"
        alignItems="center"
        right={10}
        height="100%"
        display={{ base: 'none', md: 'flex' }}
      >
        <UnorderedList styleType="none">
          <ListItem py={4}>
            <Link href="#devtools">Developer tools</Link>
          </ListItem>
          <ListItem py={4}>
            <Link href="#climate">Climate change</Link>
          </ListItem>
          <ListItem py={4}>
            <Link href="#crypto">Crypto</Link>
          </ListItem>
          <ListItem py={4}>
            <Link href="#food">Food & hospitality</Link>
          </ListItem>
        </UnorderedList>
      </Flex>
    </>
  );
};

export default Investing;
