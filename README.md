# Personal Site

My personal site (live on [https://nimo.fyi](https://nimo.fyi)) - a minimal landing page with text scrambler animation and a hidden terminal mode.

## Features

### Main Site
- Text scrambler animation with glitch effects
- Minimal design with vanilla CSS

### Terminal Mode (Secret Feature!)
Press `~` (or `t`) on the landing page, or visit `?mode=terminal`, to unlock:
- Retro terminal boot sequence
- AI chat interface powered by Claude Haiku 5.5 (remembers the conversation)
- Neon green terminal aesthetics
- Answer questions about me in terminal-style

### Reading Workflows
- `/api/readwise-webhook` - stores each new Readwise Reader document's full text, summarizes it (Claude Sonnet 5.5) and tags it, reusing existing tags and creating new ones when needed (Claude Haiku 5.5)
- `/api/sync-documents` - daily cron that mirrors the library into Postgres and fills in missing summaries
- `/api/tag-glossary` - weekly cron where Claude Opus 5.5 defines and clusters every tag and Claude Sonnet 5.5 writes a brief per tag
- `/reading` - a public map of everything I've saved: tag clusters, how they've moved over time, and a brief per tag
- `/api/rebalance-tags` - weekly cron where Claude Opus 5.5 merges duplicate and overlapping tags
- Every LLM call is saved to Postgres (request, response, result, tokens and cost) for comparing models later
- `/api/update-prices` - daily cron that keeps model prices in line with Anthropic's pricing page, dated so each call is priced at the rate it was made at
- `/api/weekly-summary` - weekly cron that emails a Claude Opus 5.5 summary of my reading
- `/api/reading-synthesis` - monthly cron (or a one-off over any window) that emails a Claude Opus 5.5 synthesis of everything I saved: themes, how my reading changed, and its own observations

### Likes
- `/likes` - a private collection of links, notes and photos I like, each organized by Claude Haiku 5.5 (which searches the web to identify products and places)
- `mac/` - Likes.app, a menu bar app that saves links, photos and text to `/likes` (`mac/build.sh --install`)
- `/api/mcp` - an MCP server, so Claude or ChatGPT can save likes and search and read my likes and reading
- A monthly email of a few things I liked a while back

## Tech Stack

- **React 19** - UI
- **TypeScript 6** - Strict type safety
- **Vite 8** - Dev server and build
- **Vanilla CSS** - No framework bloat
- **Vercel Functions** - Backend API (`/api`)
- **Anthropic Claude** - Haiku 5.5 for terminal chat and tagging, Sonnet 5.5 for document summaries and tag briefs, Opus 5.5 for tag rebalancing, the glossary and reading emails
- **Resend** - Weekly summary email
- **Neon Postgres** - LLM trace log
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
