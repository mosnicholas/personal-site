# Personal Site

My personal site (live on [https://nimo.fyi](https://nimo.fyi)) - a minimal landing page with text scrambler animation and a hidden terminal mode.

## Features

### Main Site
- Text scrambler animation with glitch effects
- Minimal design with vanilla CSS
- Ultra-small bundle size (~62 KB gzipped)

### Terminal Mode (Secret Feature!)
Visit `?mode=terminal` to unlock:
- Retro terminal boot sequence
- AI chat interface powered by Claude Haiku
- Neon green terminal aesthetics
- Answer questions about me in terminal-style

## Tech Stack

- **React 19** - Latest React with modern APIs
- **TypeScript 5.9** - Strict type safety
- **Vanilla CSS** - No framework bloat
- **Create React App** - Build tooling
- **Vercel Serverless Functions** - Backend API for chat
- **Anthropic Claude Haiku** - Fast, cost-effective AI
- **Share Tech Mono** - Cool terminal font

## Quick Start

```bash
# Install dependencies
yarn install

# Run development server
yarn start

# Visit the terminal mode
open http://localhost:3000?mode=terminal
```

## Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions to Vercel.

**TL;DR**:
1. Push to GitHub
2. Import to Vercel
3. Set `ANTHROPIC_API_KEY` environment variable
4. Deploy!

## Project Structure

- `/src` - React frontend code
- `/api` - Vercel serverless functions (TypeScript)
- `CLAUDE.md` - Detailed project documentation
- `DEPLOY.md` - Deployment guide

## Development Tools

- [Vercel](https://vercel.com/) for deployment
- [Google Domains](https://domains.google) for domain management
- [Create React App](https://create-react-app.dev) for build tooling
- [eslint](https://eslint.org) & [prettier](https://prettier.io) for code formatting
- [Anthropic Claude](https://anthropic.com) for AI chat

Enjoy, and please shoot me any feedback you have!
