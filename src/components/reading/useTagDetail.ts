import { useEffect, useState } from 'react';

import type { TagDetail } from './types';

export type TagDetailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: TagDetail };

// Tag details don't change between weekly runs, so keep them for the visit
const cache = new Map<string, TagDetail>();

const isTagDetail = (value: unknown): value is TagDetail =>
  typeof value === 'object' &&
  value !== null &&
  'tag' in value &&
  Array.isArray((value as TagDetail).documents);

/** Loads /api/reading-graph?tag=<name> when a tag is selected */
const useTagDetail = (name: string | null) => {
  const [result, setResult] = useState<{
    name: string;
    state: TagDetailState;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!name || cache.has(name)) return;
    const controller = new AbortController();
    fetch(`/api/reading-graph?tag=${encodeURIComponent(name)}`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data: unknown = await response.json();
        if (!response.ok || !isTagDetail(data)) throw new Error('Bad response');
        cache.set(name, data);
        setResult({ name, state: { status: 'ready', detail: data } });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        console.error('Tag detail error:', error);
        setResult({ name, state: { status: 'error' } });
      });
    return () => controller.abort();
  }, [name, attempt]);

  const cached = name ? cache.get(name) : undefined;
  const state: TagDetailState = cached
    ? { status: 'ready', detail: cached }
    : result && result.name === name
      ? result.state
      : { status: 'loading' };

  const retry = () => {
    setResult(null);
    setAttempt((n) => n + 1);
  };

  return [state, retry] as const;
};

export default useTagDetail;
