# Deployment Guide

The site deploys to Vercel: the Vite build is served as static files and everything in `/api` runs as Vercel Functions.

## Deploying to Vercel

### 1. Import the repo
1. Go to [vercel.com](https://vercel.com) and click "Add New Project"
2. Import the `personal-site` repository
3. `vercel.json` sets the framework to Vite (build output goes to `dist`), and turns on Fluid compute, which gives functions up to 300s

### 2. Set Environment Variables
In Vercel project settings, add these for Production (and Preview if you want the features there):

| Variable                  | Used by                       | Where to get it                                       |
| ------------------------- | ----------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | chat, tagging, rebalance, summary | https://console.anthropic.com/                    |
| `DATABASE_URL`            | LLM trace log                 | Set automatically by the Neon integration (below)     |
| `READWISE_API_KEY`        | webhook + weekly summary      | https://readwise.io/access_token                       |
| `READWISE_WEBHOOK_SECRET` | `/api/readwise-webhook`       | Readwise generates it (step 5)                        |
| `RESEND_API_KEY`          | weekly summary email          | Resend → API Keys (see "Email setup" below)           |
| `WEEKLY_SUMMARY_RECIPIENT_EMAIL` | weekly summary email   | Your inbox (mail comes from `reader@nimo.fyi`)        |
| `CRON_SECRET`             | both cron jobs                | Make one up: `openssl rand -hex 32 \| pbcopy`          |

The cron endpoints refuse requests when `CRON_SECRET` isn't set. Until `READWISE_WEBHOOK_SECRET` is set, the webhook answers Readwise but doesn't tag anything (Readwise only shows the secret after its endpoint test passes). Env var changes only apply to new deployments, so redeploy after adding one.

### 3. Deploy
Push to `main` (or click "Deploy"). Vercel will:
- Run `npm install` from `package-lock.json`
- Run `npm run build` (type-checks the frontend **and** the API, then builds)
- Deploy each file in `/api` as a function and register the crons (two weekly, one monthly)

### 4. Protect the chat endpoint (free)
`/api/chat` is public and spends your Anthropic credits, so it has three layers:

1. **Built in:** each function instance allows 10 messages per minute per IP and 200 per hour overall. These counts live in memory, so they're approximate (Vercel can run several instances), but they need no setup.
2. **Exact limit - Vercel WAF rule (free on Hobby, which includes 1 rate-limit rule and 1M requests):** Project → Firewall → Configure → New Rule. If *Request Path* *equals* `/api/chat`, then *Rate Limit*: fixed window, 60s, 10 requests, key *IP*, action *Default (429)*. Save, then Review Changes → Publish.
3. **Hard spend cap:** in the Anthropic Console, put the key in its own workspace and set a monthly spend limit (e.g. $10). Nothing can spend past it.

### 5. Configure the Readwise webhook
The endpoint has to be live in production first (step 3).

1. Go to https://readwise.io/webhook and add a webhook
2. URL: `https://nimo.fyi/api/readwise-webhook` (use the apex domain: `www` answers with a redirect, which webhook POSTs don't follow)
3. Check exactly one event: **Reader Any Document Created** to tag everything (what you save, plus RSS items, newsletters and other feed items), or **Reader Non Feed Document Created** for only what you save. Each checked event is a separate delivery, so checking several tags every document several times. Don't add `reader.document.tags_updated`; the handler ignores it anyway
4. Click Test Endpoint (it passes before the secret is set), then Create Webhook. Copy the secret Readwise shows, add it to Vercel as `READWISE_WEBHOOK_SECRET`, and redeploy
5. Save any article to Reader. Within a few seconds it should have tags, and Vercel → Logs shows `/api/readwise-webhook`

### 6. Test
- Terminal chat: visit `https://<your-domain>?mode=terminal`
- Weekly summary, without sending email or saving to Readwise:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://<your-domain>/api/weekly-summary?email=false&save=false"
  ```
- Reading synthesis over the last quarter: `dry_run=true` shows how many documents it would cover and roughly how many input tokens, without calling the model; drop it to generate and email
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://<your-domain>/api/reading-synthesis?days=92&dry_run=true"
  ```
- Tag rebalance (also tags anything saved in the last `days` that has no tags; a big number backfills the library). Each run tags a few hundred documents and skips the Opus cleanup until nothing is left untagged, so repeat until `incomplete` is false:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://<your-domain>/api/rebalance-tags?days=3650"
  ```

## Tagging and the knowledge graph

Readwise holds the taxonomy: it's the set of tags in use.

- **On save** (`/api/readwise-webhook`): Claude Haiku 4.5 gives the document up to 5 tags for its main topics. It's shown the existing tags and told to reuse them, and creates a new tag only when none fits, since the taxonomy is still growing. Documents it can't place get `other`.
- **Weekly** (`/api/rebalance-tags`, Sundays 7am UTC, before the 9am summary): tags anything the webhook missed, then Claude Opus 5.5 merges duplicate and overlapping tags and sorts out `other`. Everything is applied straight away; the plan and every before → after change (with document titles) are saved in the trace log.
- **Merges stick:** each run reads earlier runs' merges from the trace log. They're shown to Opus, a retired tag that comes back is folded into its replacement without asking, and a plan can't merge a tag back into one it replaced (the first backfill flipped `ux-design` and `user-experience` between two runs).

To see every change a rebalance made, in the Neon SQL editor:

```sql
SELECT r.created_at::date AS run,
       c->>'title' AS title,
       'https://read.readwise.io/read/' || (c->>'id') AS link,
       c->'before' AS before, c->'after' AS after
FROM llm_traces r, jsonb_array_elements(r.result->'changes') c
WHERE r.kind = 'rebalance'
ORDER BY r.created_at, title;
```

## Reading synthesis

`/api/reading-synthesis` runs on the 1st of each month at 10am UTC and emails a synthesis of everything saved to the library in the last 90 days, so each month's email shows the longer arc (`?days=` from 1 to 183 for a one-off over another window). The first one, over 92 days with 89 documents, took about 3 minutes. Claude Opus 5.5 gets each document's title, source, date, tags, Readwise summary, how far you got, and your notes and highlights, and writes: the short version, the themes across everything, how the reading changed over the window, its own meta observations, what's worth reading in full, and questions to sit with. Feed items are left out unless saved to the library. It has to finish inside the 300s function limit, so if a long window times out, use a shorter one.

## LLM trace log (Neon Postgres, free)

Every LLM call (chat, tagging, rebalance, weekly summary, reading synthesis) is saved to an `llm_traces` table: the exact request, the full response, what the app did with it (tags written, rebalance changes, email subject and article ids), latency, errors, and the git commit. That's enough to replay the same inputs against another model and compare.

1. Vercel → your project → Storage → Create Database → Neon → Free plan → connect it to the project. This sets `DATABASE_URL`
2. Redeploy. The table is created on the first trace
3. Query it in the Neon console's SQL editor, e.g.
   ```sql
   SELECT created_at, subject_id, result FROM llm_traces WHERE kind = 'tagging' ORDER BY created_at DESC;
   ```

Neon's free plan has 1 GB of storage and suspends the database when idle; the first write after a few idle minutes takes about half a second longer. Chat traces include what visitors typed (never their IP).

Neon doesn't warn before the 1 GB fills up, so the weekly email ends with a line saying how full the log is, which turns into a warning at 80%. Measured sizes: about 3 KB per tagged document, 6 KB per chat message, and 25 KB a week for the rebalance and summary together. If it does fill, new traces stop saving and everything else keeps working; delete old chat traces (`DELETE FROM llm_traces WHERE kind = 'chat' AND created_at < now() - interval '90 days'`) or move to a paid plan.

## Email setup (Resend + nimo.fyi)

Done: `nimo.fyi` is verified in a personal Resend account (free: 3,000 emails/month), and the summary comes from `reader@nimo.fyi`. The `send` and `rsend` records are Resend's bounce handling, not a sending address. To redo it from scratch:

1. Sign up at https://resend.com, then Domains → Add Domain → `nimo.fyi` (region `us-east-1`)
2. nimo.fyi's DNS is at Squarespace Domains. In Squarespace → Domains → nimo.fyi → DNS → Custom records, add exactly what Resend shows. The host is just the part before `.nimo.fyi`:

   | Type | Host                | Value                                            | Priority |
   | ---- | ------------------- | ------------------------------------------------ | -------- |
   | MX   | `send`              | `feedback-smtp.us-east-1.amazonses.com`          | 10       |
   | TXT  | `send`              | `v=spf1 include:amazonses.com ~all`              |          |
   | TXT  | `resend._domainkey` | the `p=...` key Resend generates for you         |          |
   | TXT  | `_dmarc` (optional) | `v=DMARC1; p=none;`                              |          |

   These live on the `send` subdomain, so they don't touch the existing Mailgun MX/SPF records on the root domain.
3. Click Verify in Resend (usually minutes, can take up to 72 hours)
4. API Keys → Create, permission "Sending access", domain `nimo.fyi` → set as `RESEND_API_KEY` in Vercel

## Local Development

```bash
nvm use
npm install
npm install -g vercel   # once
cp .env.example .env    # fill in the keys you need
npm start               # vercel dev: site + API
```

Visit `http://localhost:3000?mode=terminal`.

## Architecture

```
personal-site/
├── api/
│   ├── chat.ts              # Terminal chat (Claude Haiku 4.5, rate limited)
│   ├── readwise-webhook.ts  # Tags new Readwise documents from the taxonomy (Haiku 4.5)
│   ├── rebalance-tags.ts    # Weekly taxonomy rebalance cron (Opus 5.5)
│   ├── weekly-summary.ts    # Weekly reading summary cron (Opus 5.5)
│   └── _lib/                # Shared helpers (underscore = not deployed as functions)
├── src/                     # React app
├── index.html               # Vite entry
├── vercel.json              # Framework, Fluid compute, crons
└── package.json
```

All functions use the Web standard `export default { fetch(request) }` signature, so they need no Vercel-specific packages.

## Troubleshooting

### Chat shows "ERROR: Connection lost"
- Check `ANTHROPIC_API_KEY` is set in Vercel and redeploy
- Check the function logs for `/api/chat` in the Vercel dashboard

### Chat shows "ERROR: Backend not reachable" locally
- You're on `npm run start:web`; use `npm start` (needs the Vercel CLI) to run the API too

## Further Customization

### Change the AI Model
Edit `MODEL` in `api/chat.ts` (currently `claude-haiku-4-5`). Model list: https://platform.claude.com/docs/en/about-claude/models/overview

### Customize System Prompt
Edit the `SYSTEM_PROMPT` constant in `api/chat.ts`.

### Change the reading models
- Tagging: `TAGGING_MODEL`, `MAX_TAGS`, and the tagging rules in `SYSTEM_PROMPT` in `api/_lib/tagging.ts`
- Rebalance: `PLAN_MODEL` and the taxonomy rules in `SYSTEM_PROMPT` in `api/_lib/rebalance.ts`
- Weekly summary: `SUMMARY_MODEL` in `api/_lib/summary.ts` (Claude via the Anthropic SDK)

The weekly summary and rebalance stream long Opus responses and can take a couple of minutes. Without Fluid compute, Hobby functions stop after 10s (this project predates Fluid compute, so it was off), so `vercel.json` sets `"fluid": true`, which raises the default to 300s, Hobby's maximum. (Setting `maxDuration: 300` per function as well fails the deploy with "invalid maxDuration for plan".)
