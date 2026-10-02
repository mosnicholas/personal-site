# Personal Site

My personal site (live on [https://nimo.fyi](https://nimo.fyi)) - a minimal landing page with text scrambler animation and a hidden terminal mode.

## Features

### Main Site
- Text scrambler animation with glitch effects
- Minimal design with vanilla CSS

### Terminal Mode (Secret Feature!)
Press `~` (or `t`) on the landing page, or visit `?mode=terminal`, to unlock:
- Retro terminal boot sequence
- AI chat interface powered by Claude Haiku 4.5 (remembers the conversation)
- Neon green terminal aesthetics
- Answer questions about me in terminal-style

### Reading Workflows
- `/api/readwise-webhook` - auto-tags new Readwise Reader documents with Claude Haiku 4.5
- `/api/weekly-summary` - weekly cron that emails a Claude Opus 5.5 summary of my reading

## Tech Stack

- **React 19** - UI
- **TypeScript 6** - Strict type safety
- **Vite 8** - Dev server and build
- **Vanilla CSS** - No framework bloat
- **Vercel Functions** - Backend API (`/api`)
- **Anthropic Claude** - Haiku 4.5 for terminal chat and tagging, Opus 5.5 for reading summaries
- **Resend** - Weekly summary email
- **Share Tech Mono** - Cool terminal font

## Quick Start

```bash
# Use the pinned Node version
nvm use

# Install dependencies
npm install

# Install the Vercel CLI once (used to run the API functions locally)
npm install -g vercel

# Create .env with the keys you need (see .env.example)
cp .env.example .env

# Run the site and API functions together
npm start

# Or just the frontend (no API)
npm run start:web
```

## Scripts

| Script              | What it does                                |
| ------------------- | ------------------------------------------- |
| `npm start`         | `vercel dev` - site + API functions          |
| `npm run start:web` | Vite dev server only                        |
| `npm run build`     | Type-check everything, then build to `dist` |
| `npm run lint`      | ESLint                                      |
| `npm run format`    | Prettier                                    |

## Dependency Policy

`.npmrc` sets `min-release-age=7`, so npm only installs package versions that have been published for at least a week. That gives the registry time to catch and pull compromised releases before they reach this project.

## Deployment

See [DEPLOY.md](./DEPLOY.md) for full deployment instructions to Vercel.

## Project Structure

- `/src` - React frontend code
- `/api` - Vercel Functions (TypeScript); shared helpers live in `/api/_lib`
- `CLAUDE.md` - Detailed project documentation
- `DEPLOY.md` - Deployment guide

Enjoy, and please shoot me any feedback you have!
