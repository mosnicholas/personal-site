# Personal Site - Code Structure & Context

## Project Overview
Personal site for Nicholas Moschopoulos (nimo), live at nimo.fyi. Three parts:

1. **Landing page** - "nicholas moschopoulos" scrambles in, becomes a glitching "nimo", and the tagline streams in like an LLM response.
2. **Terminal mode** (`?mode=terminal`, or press `~`/`t` on the landing page) - retro boot sequence, then a chat with a Claude-powered assistant about nimo.
3. **Reading workflows** (migrated from n8n) - a Readwise webhook that tags new documents from a tag taxonomy, a weekly cron that rebalances the taxonomy, and a weekly cron that emails an AI summary of the week's reading.

## Tech Stack
- **React 19.3** + **TypeScript 6.0** (strict), vanilla CSS
- **Vite 8** for dev server and build (migrated from the deprecated Create React App)
- **Vercel** for hosting; `/api/*.ts` are Vercel Functions
- **Node 24 LTS** (`.nvmrc`), **npm** (`package-lock.json`)
- **Anthropic SDK** for all AI: `claude-haiku-4-5` for terminal chat and tagging, `claude-opus-5-5` for the weekly tag rebalance and summary
- **Neon Postgres** (`@neondatabase/serverless`, `DATABASE_URL`) for the LLM trace log
- **Resend** for email (personal account, `nimo.fyi` verified; sender `reader@nimo.fyi`, recipient `WEEKLY_SUMMARY_RECIPIENT_EMAIL`)
- ESLint 10 (flat config, typescript-eslint, react-hooks) + Prettier 3

## Project Structure

```
personal-site/
├── index.html                 # Vite entry (Google Analytics tag lives here)
├── public/                    # favicon, manifest, robots.txt
├── src/
│   ├── index.tsx              # createRoot + font imports
│   ├── index.css              # All styles and animations
│   ├── App.tsx                # Picks Landing vs TerminalMode from the URL
│   ├── components/
│   │   ├── TextScrambler.tsx  # Scramble animation, fires onComplete after holdMs
│   │   ├── StreamingText.tsx  # Char-by-char reveal
│   │   ├── Tagline.tsx        # "adventurer, cook, and founder of Junior" + link
│   │   ├── TerminalMode.tsx   # Boot sequence (staged timeouts) then chat
│   │   └── ChatInterface.tsx  # Terminal chat UI, POSTs to /api/chat
│   ├── hooks/useScrambledText.ts
│   └── utils/textScramble.ts  # Scramble algorithm
├── api/
│   ├── chat.ts                # Terminal assistant (system prompt lives here)
│   ├── readwise-webhook.ts    # Tags new Readwise Reader docs from the taxonomy
│   ├── rebalance-tags.ts      # Sunday 7am UTC cron: rebalance the taxonomy
│   ├── weekly-summary.ts      # Sunday 9am UTC cron: email the reading summary
│   ├── tsconfig.json          # Node/ESM config; Vercel also uses it to compile /api
│   └── _lib/                  # Helpers; underscore keeps Vercel from deploying them as functions
│       ├── anthropic.ts       # Shared Anthropic client (checks ANTHROPIC_API_KEY)
│       ├── auth.ts            # Constant-time secret comparison, cron auth
│       ├── email.ts           # Resend client
│       ├── rate-limit.ts      # In-memory per-instance rate limiter for /api/chat
│       ├── readwise.ts        # Readwise Reader v3 client (list, tags, bulk update)
│       ├── rebalance.ts       # Weekly rebalance: sweep, Opus plan, bulk rewrite
│       ├── summary.ts         # Weekly summary via Claude Opus 5.5 (streaming)
│       ├── tagging.ts         # Haiku tagger: reuses existing tags, creates new ones when needed
│       ├── taxonomy.ts        # `other` tag, tag normalization, cached tag list
│       └── traces.ts          # Saves every LLM call to Postgres (`llm_traces`)
├── vite.config.ts
├── eslint.config.js
├── tsconfig.json              # References tsconfig.app.json, tsconfig.node.json, api/
├── vercel.json                # framework: vite, fluid: true, 300s for the crons, crons
└── .npmrc                     # min-release-age=7
```

## Key Behavior

### Landing animation (`App.tsx`)
1. `TextScrambler` scrambles in "nicholas moschopoulos" (new random chars every 50ms; each char locks in with probability rising per tick, so it solves left-to-right in ~4-5s)
2. Solved text holds for 1s (`holdMs`), then "nimo" appears with the CSS glitch (`.nimo-glitch` + `::before`/`::after` keyframes)
3. `StreamingText` streams the tagline at 40ms/char, then it's swapped for `Tagline` with the Junior link
4. After 3s a "Press ~ for terminal mode" hint fades in

### Terminal mode
- `TerminalMode` reveals the boot log in stages (`STAGE_DELAYS_MS`), then renders `ChatInterface`
- `ChatInterface` refocuses the prompt on any keypress, draws a fake block cursor at `input.length` ch (monospace font), and keeps the conversation in React state: each request sends the last 20 messages, skipping error notices and the messages that got them. Reloading the page starts a new conversation
- On touch devices the landing hint reads "Tap for terminal mode" (CSS `hover: none` media query); it's a link to `?mode=terminal` everywhere

### Tag taxonomy (knowledge graph)
- Readwise is the source of truth: the taxonomy is the set of tags in use, normalized to lowercase kebab-case
- The taxonomy is still being created, so the save-time tagger (Haiku 4.5) may create tags: it's shown the existing tags, told to reuse them, and creates one only when none covers a main topic. `other` is for documents it can't place. Don't swap in a closed-set classifier (decision models like Jev) while tags are still being created
- Weekly, Opus 5.5 returns a structured plan (`merges`, `other_documents`); code validates it (no merging into/out of `other`, only known tags and documents) and rewrites tags with Readwise's bulk update
- Classifier only sees tag names, so names must be self-explanatory

### LLM traces
- Every LLM call goes through `tracedCall` / `recordTrace` in `api/_lib/traces.ts`: kind (`chat`, `tagging`, `rebalance`, `weekly_summary`), subject id (Readwise document id for tagging, run date for weekly jobs), exact request params, full response, the app's result, latency, error, `VERCEL_GIT_COMMIT_SHA`
- Rebalance traces also store every applied change (`before` → `after` tags per document), which is the undo log
- Neon's free plan stops writes at 1 GB without warning, so the weekly email ends with `describeTraceStorage()` (size, % of 1 GB, call count; a warning from 80%)
- Tracing never breaks the caller; without `DATABASE_URL` it's skipped. New LLM calls should be traced too

### API functions
- All use the Web standard `export default { fetch(request: Request) }` signature - no `@vercel/node`
- `chat.ts`: takes `{ messages: [{ role, content }] }`, validates it (user turns <= 500 chars, last 20 kept, must end on a user turn), calls Claude Haiku 4.5, returns `{ response }`; errors return `{ error }` without internal details. Rate limited per instance: 10/min per IP, 200/hour overall (see DEPLOY.md for the free WAF rule and Anthropic spend cap)
- `readwise-webhook.ts`: only handles `*document.created` events to avoid loops (anything else gets a 200 `skipped`, no secret needed); acts only with a matching `READWISE_WEBHOOK_SECRET` (Readwise sends it as `secret` in the body), and answers 200 without acting while it's unset, because Readwise won't create the webhook (and reveal the secret) until its endpoint test passes; tags the document via `classifyDocument` against the current taxonomy and replaces its tags (the user never tags by hand)
- `rebalance-tags.ts`: same cron auth; `?days=` (default 8) sets how far back to look for untagged documents, so a big value backfills. Applies changes directly, no review step. Works within a ~220s time budget and reports `incomplete` if it stopped early; it's idempotent, so the next run continues. The sweep lists each location a page at a time (library first, then the feed, which can hold thousands of items against a 20 requests/min limit), tags as it goes, and skips the Opus plan until nothing is left untagged
- `weekly-summary.ts`: requires `Authorization: Bearer $CRON_SECRET` (Vercel cron sends this; `rejectUnauthorizedCron` in `_lib/auth.ts`); `?days=` (1-31), `?email=false`, `?save=false` for manual runs. It summarizes documents saved or opened in the window, not everything updated: rewriting tags can bump `updated_at` on old documents. The summary is written by Claude Opus 5.5 at `medium` effort with server-side refusal fallbacks (`fallbacks: "default"`)

## Development

```bash
nvm use && npm install
npm install -g vercel   # once; needed for npm start
npm start               # vercel dev: site + API (needs .env, see .env.example)
npm run start:web       # Vite only, no API
npm run build           # tsc -b (src + api) then vite build -> dist/
npm run lint
npm run format
```

### Verifying changes
- `npm run build` must pass - it type-checks the frontend and the API, and Vercel runs it on deploy
- `npm run lint` should be clean
- No test suite

### Dependencies
- `.npmrc` sets `min-release-age=7`: npm only installs versions published at least 7 days ago. Keep it.
- `typescript` is pinned to `~6.0`: TypeScript 7 has no JS API yet, which breaks typescript-eslint and Vercel's function compiler.
- The Vercel CLI is installed globally on purpose; as a devDependency it added ~270 packages (and every `npm audit` finding) to each deploy.
- npm blocks dependency install scripts by default; `allowScripts` in `package.json` records decisions (fsevents ships a prebuilt binary, so its script is denied).

## Design Decisions (user preferences)
- Black, minimal design; no UI framework (Chakra UI was removed to cut bundle size)
- Keep the glitch effect - the user specifically likes it
- Streaming tagline should feel like an LLM response
- No routes or booking links (removed so random people can't book calls via Calendly)

## Common Tasks
- **Scramble characters / speed**: `SCRAMBLE_CHARS` in `src/utils/textScramble.ts`, `TICK_MS` in `src/hooks/useScrambledText.ts`
- **Streaming speed**: `speed` prop in `src/App.tsx` (40ms/char)
- **Glitch**: `@keyframes glitch`, `glitchTop`, `glitchBottom` in `src/index.css`
- **Colors**: `src/index.css` (background `#000`, text `#fff`, subtitle `#9ca3af`, terminal `#00ff00`)
- **Terminal assistant persona**: `SYSTEM_PROMPT` in `api/chat.ts`
- **Tagging**: `MAX_TAGS` and rules in `SYSTEM_PROMPT` in `api/_lib/tagging.ts`; taxonomy rules in `SYSTEM_PROMPT` in `api/_lib/rebalance.ts`
- **Reading models**: `PLAN_MODEL` in `api/_lib/rebalance.ts`, `SUMMARY_MODEL` in `api/_lib/summary.ts`
- **Chat rate limits**: `perIpLimit` / `overallLimit` in `api/chat.ts`

## Commit Style
- Descriptive commit messages that explain "why", not just "what"
- Reference specific files changed
- Note bundle size impacts
