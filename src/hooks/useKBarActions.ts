import { AiOutlineLinkedin } from 'react-icons/ai';
import { BsCamera } from 'react-icons/bs';
import { FaHome } from 'react-icons/fa';
import { GiPaintRoller } from 'react-icons/gi';
import { IoMailOutline } from 'react-icons/io5';
import { MdAttachMoney, MdOutlineAlternateEmail } from 'react-icons/md';
import { VscPerson } from 'react-icons/vsc';
import { useLocation } from 'wouter';

const useKBarActions = () => {
  // eslint-disable-next-line
  const [_, setLocation] = useLocation();

  return [
    {
      id: 'home',
      icon: FaHome,
      name: 'Home',
      keywords: 'home me email',
      perform: () => setLocation('/'),
    },
    {
      id: 'about',
      icon: VscPerson,
      name: 'About',
      keywords: 'about me email',
      perform: () => setLocation('about'),
    },
    {
      id: 'connect',
      icon: MdOutlineAlternateEmail,
      name: 'Connect',
      keywords: 'contact connect reach out email',
      perform: () => setLocation('connect'),
    },
    {
      id: 'investing',
      icon: MdAttachMoney,
      name: 'Investing',
      keywords: 'investing angel startup',
      perform: () => setLocation('investing'),
    },
    {
      id: 'nfts',
      icon: GiPaintRoller,
      name: 'NFTs',
      section: 'Art',
      keywords: 'nfts crypto wallet',
      perform: () => setLocation('nfts'),
    },
    {
      id: 'photos',
      icon: BsCamera,
      name: 'Photos',
      section: 'Art',
      keywords: 'photos art photography',
      perform: () => setLocation('photos'),
    },
    {
      id: 'email',
      icon: IoMailOutline,
      name: 'Email',
      section: 'Contact',
      keywords: 'email',
      perform: () => {
        window.open(
          'mailto:nico.moschopoulos@gmail.com?subject=Hey!',
          '_blank',
        );
      },
    },
    {
      id: 'linkedIn',
      icon: AiOutlineLinkedin,
      name: 'LinkedIn',
      section: 'Contact',
      keywords: 'linkedin',
      perform: () => {
        window.open('https://www.linkedin.com/in/nimo-1/', '_blank');
      },
    },
  ];
};

export default useKBarActions;
