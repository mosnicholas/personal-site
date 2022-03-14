import {
  GridItem,
  Heading,
  Icon,
  Link,
  SimpleGrid,
  Text,
  VStack,
} from '@chakra-ui/react';
import { VscPerson } from 'react-icons/vsc';
import { Link as WouterLink } from 'wouter';

const About = () => (
  <SimpleGrid columns={3}>
    <GridItem colSpan={1} alignSelf="center">
      <Icon as={VscPerson} boxSize={20} />
    </GridItem>
    <GridItem colSpan={2} py={20}>
      <VStack
        w="100%"
        alignItems="flex-start"
        spacing={5}
        overflowY="scroll"
        maxH="400px"
      >
        <Text>
          Hello new friend, and welcome to my space! This is a place for me to
          play with new ideas and share some of them with you.
        </Text>
        <Text>
          I&apos;m a Greek-American software engineer with a love for getting
          people together. Currently residing in NYC.
        </Text>
        <Heading fontSize="lg">Career</Heading>
        <Text>
          After a few fun internships from Nest to Facebook, I started my career
          at{' '}
          <Link isExternal href="https://www.airbnb.com">
            Airbnb
          </Link>
          . After a couple of years there, I started itching for something
          smaller and more exciting. I left to join{' '}
          <Link isExternal href="https://www.petalcard.com">
            Petal Card
          </Link>
          , where I built our web and native apps to help the financially
          underserved manage and build their credit.
        </Text>
        <Text>
          In Sept 2020, I decided to take a big break from tech and quit Petal
          to pursue a separate passion, and went to{' '}
          <Link isExternal href="https://noma.dk">
            Noma
          </Link>{' '}
          to intern in the kitchen. It was a remarkable and challenging few
          months, but I fell in love with Denmark and food.
        </Text>
        <Heading fontSize="lg">Currently</Heading>
        <Text>
          In May of 2021, I found myself back into startup land, joining the
          team at{' '}
          <Link isExternal href="https://www.getjuice.com">
            Creative Juice
          </Link>{' '}
          to build tools for those seeking passion in creating. I&apos;m so
          excited about the future and where we&apos;re going! If you have any
          interest in joining us at Juice, please{' '}
          <Link as={WouterLink} href="/connect">
            reach out
          </Link>
          !
        </Text>
        <Text>
          Aside from Creative Juice, I recently completed a 6-month fellowship
          at{' '}
          <Link isExternal href="https://susaventures.com">
            Susa Ventures
          </Link>
          . I met some of the humblest and smartest venture investors that
          I&apos;ve ever had the pleasure of meeting, and am so humbled by the
          experience. I was lucky enough to learn about the world of venture
          from them, and have been enjoying applying that in practice the last
          few months.
        </Text>
      </VStack>
    </GridItem>
  </SimpleGrid>
);

export default About;
