# Deployment Guide

The site deploys to Vercel: the Vite build is served as static files and everything in `/api` runs as Vercel Functions.

## Deploying to Vercel

### 1. Import the repo
1. Go to [vercel.com](https://vercel.com) and click "Add New Project"
2. Import the `personal-site` repository
3. `vercel.json` sets the framework to Vite; build output goes to `dist`

### 2. Set Environment Variables
In Vercel project settings, add these for Production (and Preview if you want the features there):

| Variable                  | Used by                       | Where to get it                                       |
| ------------------------- | ----------------------------- | ----------------------------------------------------- |
| `ANTHROPIC_API_KEY`       | chat, tagging, rebalance, summary | https://console.anthropic.com/                    |
| `READWISE_API_KEY`        | webhook + weekly summary      | https://readwise.io/access_token                       |
| `READWISE_WEBHOOK_SECRET` | `/api/readwise-webhook`       | Readwise generates it (step 5)                        |
| `RESEND_API_KEY`          | weekly summary email          | Resend → API Keys (see "Email setup" below)           |
| `WEEKLY_SUMMARY_RECIPIENT_EMAIL` | weekly summary email   | Your inbox (mail comes from `reader@nimo.fyi`)        |
| `CRON_SECRET`             | both cron jobs                | Make one up: `openssl rand -hex 32 \| pbcopy`          |

The webhook and cron endpoints refuse requests when their secret isn't set. Env var changes only apply to new deployments, so redeploy after adding one.

### 3. Deploy
Push to `main` (or click "Deploy"). Vercel will:
- Run `npm install` from `package-lock.json`
- Run `npm run build` (type-checks the frontend **and** the API, then builds)
- Deploy each file in `/api` as a function and register the two weekly crons

### 4. Protect the chat endpoint (free)
`/api/chat` is public and spends your Anthropic credits, so it has three layers:

1. **Built in:** each function instance allows 10 messages per minute per IP and 200 per hour overall. These counts live in memory, so they're approximate (Vercel can run several instances), but they need no setup.
2. **Exact limit - Vercel WAF rule (free on Hobby, which includes 1 rate-limit rule and 1M requests):** Project → Firewall → Configure → New Rule. If *Request Path* *equals* `/api/chat`, then *Rate Limit*: fixed window, 60s, 10 requests, key *IP*, action *Default (429)*. Save, then Review Changes → Publish.
3. **Hard spend cap:** in the Anthropic Console, put the key in its own workspace and set a monthly spend limit (e.g. $10). Nothing can spend past it.

### 5. Configure the Readwise webhook
The endpoint has to be live in production first (step 3).

1. Go to https://readwise.io/webhook and add a webhook
2. URL: `https://nimo.fyi/api/readwise-webhook` (use the apex domain: `www` answers with a redirect, which webhook POSTs don't follow)
3. Event: `reader.non_feed_document.created` to tag what you save, or `reader.any_document.created` to also tag every RSS feed item. Don't add `reader.document.tags_updated`; the handler ignores it anyway
4. Save, copy the secret Readwise shows, add it to Vercel as `READWISE_WEBHOOK_SECRET`, and redeploy
5. Save any article to Reader. Within a few seconds it should have tags, and Vercel → Logs shows `/api/readwise-webhook`

### 6. Test
- Terminal chat: visit `https://<your-domain>?mode=terminal`
- Weekly summary, without sending email or saving to Readwise:
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://<your-domain>/api/weekly-summary?email=false&save=false"
  ```
- Tag rebalance (also tags anything saved in the last `days` that has no tags; a big number backfills the library, repeat until `incomplete` is false):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" \
    "https://<your-domain>/api/rebalance-tags?days=3650"
  ```

## Tagging and the knowledge graph

Readwise holds the taxonomy: it's the set of tags in use.

- **On save** (`/api/readwise-webhook`): Claude Haiku 4.5 picks up to 5 tags that name a main topic. Structured outputs restrict it to your existing tags plus `other`, so it can't invent tags. If nothing fits, or the main subject has no tag yet, the document gets `other`.
- **Weekly** (`/api/rebalance-tags`, Sundays 7am UTC, before the 9am summary): tags anything the webhook missed, then Claude Opus 5.5 merges duplicate tags and tags the `other` documents, creating a new tag once a theme shows up in at least two of them. Everything is applied straight away; the plan is in the function logs.

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
├── vercel.json              # Framework + cron config
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

The weekly summary and rebalance stream long Opus responses and can take a couple of minutes. That fits in Vercel's 300s limit on Hobby with Fluid compute (on by default for new projects; check Settings → Functions if the cron times out).
