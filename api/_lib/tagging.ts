/**
 * Article tagging with TypeSafe's Jev, a classifier that returns calibrated
 * probabilities instead of generated text. Each tag in the taxonomy is one
 * yes/no question, all answered in a single request.
 * Docs: https://docs.typesafe.ai/api
 */

import { OTHER_TAG } from './taxonomy.js';

const TYPESAFE_API_URL = 'https://api.typesafe.ai/v1/systemone';
const JEV_MODEL = 'jev-latest';
// A tag applies when Jev is at least this sure it's a main topic
const TAG_THRESHOLD = 0.6;
const MAX_TAGS = 5;
// Below this, the main subject isn't covered by any tag yet
const COVERED_THRESHOLD = 0.5;

export interface TaggableDocument {
  title: string;
  author: string | null;
  url: string;
  summary: string | null;
}

interface NoulQuestion {
  type: 'noul';
  instructions: string | Record<string, unknown>;
}

const topic = (tag: string) => tag.replace(/-/g, ' ');

/**
 * Picks tags for a document from `taxonomy`. Adds `other` when nothing fits
 * or the document's main subject has no tag yet.
 */
export async function classifyDocument(
  document: TaggableDocument,
  taxonomy: string[],
): Promise<string[]> {
  if (taxonomy.length === 0) return [OTHER_TAG];

  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) {
    throw new Error('TYPESAFE_API_KEY environment variable is not set');
  }

  const questions: Record<string, NoulQuestion> = {
    covered: {
      type: 'noul',
      instructions: {
        topics: taxonomy.map(topic),
        question: 'Does `topics` include the main subject of `document`?',
      },
    },
  };
  taxonomy.forEach((tag, i) => {
    questions[`tag_${i}`] = {
      type: 'noul',
      instructions: `Is "${topic(tag)}" one of the main topics of \`document\`, not just a passing mention?`,
    };
  });

  const response = await fetch(TYPESAFE_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ model: JEV_MODEL, state: { document }, questions }),
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`TypeSafe API error (${response.status}): ${errorText}`);
  }

  const { answers } = (await response.json()) as {
    answers: Record<string, { noul: number }>;
  };

  const tags = taxonomy
    .map((tag, i) => ({ tag, p: answers[`tag_${i}`]?.noul ?? 0 }))
    .filter(({ p }) => p >= TAG_THRESHOLD)
    .sort((a, b) => b.p - a.p)
    .slice(0, MAX_TAGS)
    .map(({ tag }) => tag);

  if (tags.length === 0 || (answers.covered?.noul ?? 1) < COVERED_THRESHOLD) {
    tags.push(OTHER_TAG);
  }
  return tags;
}
