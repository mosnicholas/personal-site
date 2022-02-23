import { keyframes } from '@emotion/react';

const glitch = keyframes`
  2%,64%{
    transform: translate(2px, 0) skew(0deg);
  }
  4%,60%{
    transform: translate(-2px, 0) skew(0deg);
  }
  62%{
    transform: translate(0, 0) skew(5deg);
  }
`;

const glitchTop = keyframes`
  2%,64%{
    transform: translate(2px, -2px);
  }
  4%,60%{
    transform: translate(-2px, 2px);
  }
  62%{
    transform: translate(13px, -1px) skew(-13deg);
  }
`;

const glitchBottom = keyframes`
  2%,64%{
    transform: translate(-2px, 0);
  }
  4%,60%{
    transform: translate(-2px, 0);
  }
  62%{
    transform: translate(-22px, 5px) skew(21deg);
  }
`;

const generateGlitchAnimation = (content: string) => ({
  animation: `${glitch} 0.5s linear infinite`,
  _before: {
    content: `'${content}'`,
    position: 'absolute',
    left: '0',
    animation: `${glitchTop} 0.5s linear infinite`,
    clipPath: 'polygon(0 0, 100% 0, 100% 33%, 0 33%)',
  },
  _after: {
    content: `'${content}'`,
    position: 'absolute',
    left: '0',
    animation: `${glitchBottom} 1.5s linear infinite`,
    clipPath: 'polygon(0 67%, 100% 67%, 100% 100%, 0 100%)',
  },
});

export default generateGlitchAnimation;
