import { useLocation } from 'wouter';

const useKBarActions = () => {
  const [_, setLocation] = useLocation();

  return [
    {
      id: 'about',
      name: 'About',
      keywords: 'about me email',
      perform: () => setLocation('about'),
    },
    {
      id: 'connect',
      name: 'Connect',
      keywords: 'contact connect reach out email',
      perform: () => setLocation('connect'),
    },
    {
      id: 'investing',
      name: 'Investing',
      keywords: 'investing angel startup',
      perform: () => setLocation('investing'),
    },
    {
      id: 'nfts',
      name: 'NFTs',
      keywords: 'nfts crypto wallet',
      perform: () => setLocation('nfts'),
    },
    {
      id: 'photos',
      name: 'Photos',
      keywords: 'photos art photography',
      perform: () => setLocation('photos'),
    },
    {
      id: 'email',
      name: 'Email',
      section: 'Contact',
      keywords: 'email',
      perform: () => {
        window.open('mailto:nico.moschopoulos@gmail.com?subject=Hey!');
      },
    },
  ];
};

export default useKBarActions;
