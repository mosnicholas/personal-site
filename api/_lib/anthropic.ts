import Anthropic from '@anthropic-ai/sdk';

let client: Anthropic | undefined;

/**
 * Shared Anthropic client. Throws if ANTHROPIC_API_KEY isn't set.
 */
export function getAnthropic(): Anthropic {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set');
  }
  client ??= new Anthropic();
  return client;
}
