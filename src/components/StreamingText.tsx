import { useEffect, useState } from 'react';

type StreamingTextProps = {
  text: string;
  speed?: number;
  className?: string;
  onComplete?: () => void;
};

const StreamingText = ({
  text,
  speed = 30,
  className = '',
  onComplete,
}: StreamingTextProps) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex < text.length) {
      const timeout = setTimeout(() => {
        setDisplayedText((prev) => prev + text[currentIndex]);
        setCurrentIndex((prev) => prev + 1);
      }, speed);

      return () => clearTimeout(timeout);
    }

    if (currentIndex === text.length && onComplete) {
      onComplete();
    }

    return undefined;
  }, [currentIndex, text, speed, onComplete]);

  return <div className={className}>{displayedText}</div>;
};

StreamingText.defaultProps = {
  speed: 30,
  className: '',
  onComplete: undefined,
};

export default StreamingText;
