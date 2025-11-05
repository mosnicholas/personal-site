const Anthropic = require('@anthropic-ai/sdk');

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

module.exports = async (req, res) => {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
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
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Check for API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'API key not configured. Set ANTHROPIC_API_KEY in Vercel environment variables.'
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
    const assistantMessage = response.content[0].text;

    res.status(200).json({ response: assistantMessage });
  } catch (error) {
    console.error('Error calling Anthropic API:', error);
    res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message
    });
  }
};
