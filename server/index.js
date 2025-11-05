const express = require('express');
const cors = require('cors');
const Anthropic = require('@anthropic-ai/sdk');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

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

app.use(cors());
app.use(express.json());

app.post('/api/chat', async (req, res) => {
  try {
    const { message } = req.body;

    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

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

    res.json({ response: assistantMessage });
  } catch (error) {
    console.error('Error calling Anthropic API:', error);
    res.status(500).json({
      error: 'Failed to process chat message',
      details: error.message
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api/chat`);
});
