import Anthropic from '@anthropic-ai/sdk';
import type { VercelRequest, VercelResponse } from '@vercel/node';

// System prompt with info about Nicholas/nimo
const SYSTEM_PROMPT = `You are a terminal assistant for Nicholas Moschopoulos (also known as "nimo").
You should answer basic questions about him in a brief, terminal-like style. Keep responses concise and technical.

About Nicholas/nimo:
- Full name: Nicholas Moschopoulos
- Goes by: nimo
- Interests: adventurer, cook
- Professional: Founder of Junior (myjunior.ai) - an AI coding assistant
- Background: Software engineer and entrepreneur
- Style: Technical, minimal, enjoys glitch aesthetics and retro computing

Keep responses SHORT (1-3 sentences max). Be direct and terminal-like. If asked about things unrelated to Nicholas/nimo, politely redirect or say you only answer questions about nimo.`;

interface ChatRequestBody {
  message: string;
}

interface ChatResponse {
  response: string;
}

interface ErrorResponse {
  error: string;
  details?: string;
}

export default async (
  req: VercelRequest,
  res: VercelResponse<ChatResponse | ErrorResponse>
) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle OPTIONS request for CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only allow POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { message } = req.body as ChatRequestBody;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'API key not configured. Set ANTHROPIC_API_KEY in Vercel environment variables.',
      });
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Call Anthropic API with Claude Haiku
    const response = await anthropic.messages.create({
      model: 'claude-3-5-haiku-20241022',
      max_tokens: 200,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: message,
        },
      ],
    });

    // Extract the text response
    const firstContent = response.content[0];
    if (firstContent.type !== 'text') {
      throw new Error('Unexpected response type from Anthropic API');
    }

    const assistantMessage = firstContent.text;

    return res.status(200).json({ response: assistantMessage });
  } catch (error) {
    console.error('Error calling Anthropic API:', error);
    return res.status(500).json({
      error: 'Failed to process chat message',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
};
