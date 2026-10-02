/**
 * The judge's two jobs, shared by the API judge (judge.ts) and the Claude
 * Code agents (agents.ts), so both grade the same way.
 */

export const EXTRACT_PROMPT = `You help evaluate summaries in a personal reading library, where summaries let the reader recall what a piece said and decide whether to read it in full. List the document's key points: what that reader would most need from a summary. Mark each essential (a summary that misses it fails the reader) or important (a good summary includes it). One short, self-contained sentence each.`;

export const SCORE_PROMPT = `You check a summary from a personal reading library, where summaries let the reader recall what a piece said and decide whether to read it in full. You get the document, its numbered key points, and the summary.
- coverage: for each key point, whether the summary covers it fully, partly, or not at all.
- issues: every statement in the summary that the document doesn't support or that contradicts it, quoted from the summary, with the kind of problem. Judgments about the document (that it's speculative, or worth reading for some readers) count as supported when the document bears them out.
- readability: how easy the summary is to take in when skimming, from 1 (hard to follow: a wall of text, poorly ordered) to 5 (main point first, clearly organized, easy to scan), with a one-sentence reason.`;

export const KEY_POINTS_SCHEMA = {
  type: 'object',
  properties: {
    key_points: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          point: { type: 'string' },
          importance: { type: 'string', enum: ['essential', 'important'] },
        },
        required: ['point', 'importance'],
        additionalProperties: false,
      },
    },
  },
  required: ['key_points'],
  additionalProperties: false,
};

export const GRADE_SCHEMA = {
  type: 'object',
  properties: {
    coverage: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key_point: { type: 'integer' },
          verdict: { type: 'string', enum: ['full', 'partial', 'missing'] },
        },
        required: ['key_point', 'verdict'],
        additionalProperties: false,
      },
    },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          quote: { type: 'string' },
          problem: {
            type: 'string',
            enum: [
              'unsupported',
              'contradicted',
              'misattributed',
              'overstated',
            ],
          },
          explanation: { type: 'string' },
        },
        required: ['quote', 'problem', 'explanation'],
        additionalProperties: false,
      },
    },
    readability: {
      type: 'object',
      properties: {
        score: { type: 'integer' },
        reason: { type: 'string' },
      },
      required: ['score', 'reason'],
      additionalProperties: false,
    },
  },
  required: ['coverage', 'issues', 'readability'],
  additionalProperties: false,
};
