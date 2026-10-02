import { useEffect, useEffectEvent, useState } from 'react';

type StreamingTextProps = {
  text: string;
  /** Milliseconds per character. */
  speed?: number;
  className?: string;
  onComplete?: () => void;
};

const StreamingText = ({
  text,
  speed = 30,
  className,
  onComplete,
}: StreamingTextProps) => {
  const [visibleChars, setVisibleChars] = useState(0);
  const handleComplete = useEffectEvent(() => onComplete?.());

  useEffect(() => {
    if (visibleChars >= text.length) {
      handleComplete();
      return undefined;
    }

    const timeout = setTimeout(() => setVisibleChars((n) => n + 1), speed);
    return () => clearTimeout(timeout);
  }, [visibleChars, text.length, speed]);

  return <div className={className}>{text.slice(0, visibleChars)}</div>;
};

export default StreamingText;
