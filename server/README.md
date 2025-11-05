# Terminal Chat Backend Server

Backend API server for the nimo terminal chat interface, powered by Anthropic Claude Haiku.

## Setup

1. Install dependencies:
```bash
cd server
yarn install
```

2. Create `.env` file from the example:
```bash
cp .env.example .env
```

3. Add your Anthropic API key to `.env`:
```
ANTHROPIC_API_KEY=your_actual_api_key_here
```

Get your API key from: https://console.anthropic.com/

## Running the Server

### Production mode:
```bash
yarn server
```

### Development mode (with auto-reload):
```bash
yarn server:dev
```

The server will run on `http://localhost:3001` by default.

## API Endpoints

### POST /api/chat
Send a message to the chat bot.

**Request:**
```json
{
  "message": "Who is nimo?"
}
```

**Response:**
```json
{
  "response": "nimo (Nicholas Moschopoulos) is an adventurer, cook, and founder of Junior (myjunior.ai), an AI coding assistant."
}
```

### GET /api/health
Health check endpoint.

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2025-11-05T12:34:56.789Z"
}
```

## Development

The React app is configured to proxy API requests to this server during development (see `proxy` in `package.json`).

When running the full app:
1. Start the backend server: `yarn server:dev`
2. Start the React app: `yarn start`
3. Visit: `http://localhost:3000?mode=terminal`

## Model Configuration

Currently using **Claude 3.5 Haiku** (`claude-3-5-haiku-20241022`) for fast, cost-effective responses.
- Max tokens: 200 (keeps responses concise)
- System prompt configures bot to answer questions about Nicholas/nimo
- Terminal-style responses (brief and technical)
