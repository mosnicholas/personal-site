import Anthropic from '@anthropic-ai/sdk';

import { getAnthropic } from './_lib/anthropic.js';
import { clientIp, createRateLimiter } from './_lib/rate-limit.js';

const MODEL = 'claude-haiku-4-5';
const MAX_MESSAGE_LENGTH = 500;
// Replies are capped by max_tokens (~4k chars); this bounds what clients echo back
const MAX_REPLY_LENGTH = 8000;
// Last 10 exchanges
const MAX_HISTORY_MESSAGES = 20;

// System prompt with info about Nicholas/nimo
const SYSTEM_PROMPT = `You are a terminal assistant for Nicholas Moschopoulos (also known as "nimo").
You respond in a concise, terminal-style format with personality.

RESPONSE STYLE:
- Keep responses SHORT (2-5 lines max)
- Use terminal formatting: [INFO], [SUCCESS], → bullets, ─────── dividers
- Be playful but professional - not boring corporate
- Use minimal emojis only when appropriate: ✓ ✗ → *
- For commands, format responses like terminal output
- For questions, answer naturally but briefly

ABOUT NIMO:
Name: Nicholas Moschopoulos (goes by "nimo")
Role: Founder & CEO @ Junior (myjunior.ai)
Focus: Building AI coding assistants that actually help developers
Background: Software engineer, serial entrepreneur, startup veteran
Interests: Adventure travel, cooking, glitch aesthetics, retro computing, minimalist design
Style: Technical minimalist who appreciates the beauty of a good terminal

AVAILABLE COMMANDS (respond to these if user types them):

help | ?
  → Show available commands with brief descriptions

about
  → Brief bio: who is nimo, what he does, what drives him

whoami
  → Meta response: "You're chatting with nimo's terminal assistant"

projects
  → Junior (AI coding assistant) + any other notable projects
  → Emphasize Junior's mission to help developers

skills
  → Technical stack: TypeScript, React, Node.js, AI/LLM integration, product design
  → Focus on building, shipping, iterating

experience
  → Software engineer → entrepreneur → founder
  → Built products, led teams, raised funding

contact
  → Point people to myjunior.ai
  → Never make up handles, emails, or URLs

interests
  → Adventure: travel, exploration, new experiences
  → Cooking: experimenting in the kitchen, good food
  → Tech aesthetics: glitch art, retro computing, terminals

food | recipes
  → Cooking philosophy, favorite cuisines, kitchen experiments
  → Keep it fun and personal

travel | adventure
  → Love of travel and exploration, in general terms (no made-up trips or stories)
  → Mindset: explore, take risks, seek experiences

coffee
  → Coffee preferences, developer fuel jokes
  → Keep it light and relatable

joke
  → One good programming/tech joke, terminal themed
  → Make it clever, not cheesy

quote
  → Tech or life philosophy quote, something meaningful to builders
  → Attribute if famous, or original if nimo might say it

ascii
  → Simple ASCII art (his name, logo, something cool)
  → Keep it small (3-5 lines max)

matrix
  → Matrix reference / red pill blue pill joke
  → Stay in character

sudo [anything]
  → "Nice try. Access denied 😏"
  → Or "Permission denied. You're not root here."

rm -rf | rm -rf /
  → "⚠ WOAH THERE! That's a dangerous command."
  → "Let's not delete everything today."

clear | cls
  → "Screen cleared in your imagination ✨"
  → Or "This isn't a real terminal... yet"

exit | quit
  → "You can close the browser tab, but I'll be here waiting 👋"

status
  → Current status: "Building Junior, shipping features, drinking coffee ☕"
  → What he's working on now

COMMAND HANDLING:
- If user types an exact command from the list, respond with that command's output
- If input looks like a command but isn't recognized, suggest typing "help"
- If it's a natural question, answer conversationally but stay brief and terminal-styled
- If asked about things unrelated to nimo/tech, politely redirect: "I only know about nimo. Try 'help' for commands."
- Never invent facts about nimo (handles, emails, places, employers, numbers). If you don't know, say so and point to myjunior.ai.
- Maintain personality: technical but playful, helpful but not verbose

FORMATTING EXAMPLES:

For "about":
[INFO] Nicholas "nimo" Moschopoulos
─────────────────────────────────────
→ Founder @ Junior (myjunior.ai)
→ Building AI that helps devs actually code
→ Philosophy: ship fast, iterate faster
Type 'projects' or 'contact' for more

For natural question like "what do you do?":
I build Junior, an AI coding assistant. Think of it as a really smart pair programmer that doesn't judge your variable names 😏

Check out myjunior.ai or type 'help' for commands.

Remember: Be helpful, be concise, be human. This is nimo's terminal - make it feel alive.`;

// Per function instance - see _lib/rate-limit.ts for what that means
const perIpLimit = createRateLimiter({ limit: 10, windowMs: 60_000 });
const overallLimit = createRateLimiter({ limit: 200, windowMs: 60 * 60_000 });

const errorResponse = (
  error: string,
  status: number,
  headers?: Record<string, string>,
) => Response.json({ error }, { status, headers });

/**
 * Validates the conversation the client sends back (the API is stateless, so
 * the browser keeps the history) and trims it to the most recent turns.
 */
function parseConversation(
  body: unknown,
): { messages: Anthropic.MessageParam[] } | { error: string } {
  const raw = (body as { messages?: unknown } | null)?.messages;
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: 'Message is required' };
  }

  const messages: Anthropic.MessageParam[] = [];
  for (const entry of raw.slice(-MAX_HISTORY_MESSAGES)) {
    const { role, content } = (entry ?? {}) as {
      role?: unknown;
      content?: unknown;
    };
    if (
      (role !== 'user' && role !== 'assistant') ||
      typeof content !== 'string' ||
      !content.trim()
    ) {
      return { error: 'Invalid conversation history' };
    }
    if (role === 'user' && content.length > MAX_MESSAGE_LENGTH) {
      return {
        error: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`,
      };
    }
    if (role === 'assistant' && content.length > MAX_REPLY_LENGTH) {
      return { error: 'Invalid conversation history' };
    }
    messages.push({ role, content });
  }

  // Trimming can leave an assistant turn first; the API needs a user turn there
  while (messages[0]?.role === 'assistant') messages.shift();
  if (messages.at(-1)?.role !== 'user') {
    return { error: 'Message is required' };
  }

  return { messages };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') {
      return errorResponse('Method not allowed', 405);
    }

    const ipCheck = perIpLimit(clientIp(request));
    if (!ipCheck.allowed) {
      return errorResponse('Too many messages. Try again in a minute.', 429, {
        'Retry-After': String(ipCheck.retryAfterSeconds),
      });
    }
    const overallCheck = overallLimit('all');
    if (!overallCheck.allowed) {
      return errorResponse('The terminal is busy. Try again later.', 429, {
        'Retry-After': String(overallCheck.retryAfterSeconds),
      });
    }

    const body: unknown = await request.json().catch(() => null);
    const conversation = parseConversation(body);
    if ('error' in conversation) {
      return errorResponse(conversation.error, 400);
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      console.error('ANTHROPIC_API_KEY is not set');
      return errorResponse('Chat is not configured', 500);
    }

    try {
      const response = await getAnthropic().messages.create({
        model: MODEL,
        max_tokens: 1024,
        // Caches the growing conversation once it's long enough to qualify
        cache_control: { type: 'ephemeral' },
        system: SYSTEM_PROMPT,
        messages: conversation.messages,
      });

      const text = response.content
        .flatMap((block) => (block.type === 'text' ? [block.text] : []))
        .join('\n')
        .trim();

      return Response.json({
        response:
          text || "I can't answer that one. Type 'help' to see what I can do.",
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        return errorResponse('Too many requests. Try again in a minute.', 429);
      }
      console.error('Error calling Anthropic API:', error);
      return errorResponse('Failed to process chat message', 500);
    }
  },
};
