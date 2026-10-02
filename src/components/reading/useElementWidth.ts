import { useLayoutEffect, useRef, useState } from 'react';

const SETTLE_MS = 150;

/**
 * Width of an element in whole px. The first measurement lands before paint;
 * later ones wait for resizing to settle, since a width change re-runs the
 * map layout.
 */
const useElementWidth = <T extends HTMLElement>() => {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let measured = false;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry.contentRect.width);
      clearTimeout(timer);
      if (!measured) {
        measured = true;
        setWidth(next);
      } else {
        timer = setTimeout(() => setWidth(next), SETTLE_MS);
      }
    });
    observer.observe(el);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, []);

  return [ref, width] as const;
};

export default useElementWidth;
