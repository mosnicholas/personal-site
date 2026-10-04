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
| `PERSONAL_SITE_OWNER_KEY` | `/likes` sign-in and its MCP  | Make one up: `openssl rand -hex 32 \| pbcopy`          |
| `BLOB_READ_WRITE_TOKEN`   | `/likes` photos, locally      | Not needed on Vercel once a private Blob store is connected (see /likes) |

The cron endpoints refuse requests when `CRON_SECRET` isn't set. Until `READWISE_WEBHOOK_SECRET` is set, the webhook answers Readwise but doesn't tag anything (Readwise only shows the secret after its endpoint test passes). Env var changes only apply to new deployments, so redeploy after adding one.

### 3. Deploy
Push to `main` (or click "Deploy"). Vercel will:
- Run `npm install` from `package-lock.json`
- Run `npm run build` (type-checks the frontend **and** the API, then builds)
- Deploy each file in `/api` as a function and register the crons (two daily, three weekly, one monthly)

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

## Library mirror and our summaries

Readwise stays the source of truth, and Postgres keeps a mirror of the library (`documents`) so the tagger, the emails and `/reading` don't hit Readwise's 20 requests/min limit.

- **Daily** (`/api/sync-documents`, 6am UTC): copies documents that changed in Readwise into the mirror, stores each saved document's full text (`document_texts`), and has Claude Sonnet 5.5 summarize documents that don't have a current summary. Each summary is written for recalling what a piece said and deciding whether to read it in full, structured to skim (main point first, short sections or bullets); the model picks the length. Short posts (300 words or fewer) are kept as they are. Feed items keep Readwise's summary and aren't stored in full.
- **Changing the summary prompt or model**: test it with the summary eval (`scripts/eval/README.md`), then bump `SUMMARY_VERSION` in `api/_lib/summarize.ts`. New saves get the new prompt; existing summaries stay as they are. To regenerate them all, run the sync with `?redo=true` until `incomplete` is false (about 65 a run); the next glossary run then refreshes the tag briefs.
- **On save**: the webhook writes our summary straight away when Readwise has the text ready; otherwise the next daily sync does.
- **Backfill**: the first sync lists the whole library and summarizes it over several runs. Run it until `incomplete` is false (`?summarize=false` lists only, to see the size first):
  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" "https://<your-domain>/api/sync-documents"
  ```
  Summaries cost a few cents per document (Sonnet 5.5 reads the whole text, up to ~150k tokens). Texts take roughly 25 KB per document of the 1 GB.

## Tagging and the knowledge graph

Readwise holds the taxonomy: it's the set of tags in use.

- **On save** (`/api/readwise-webhook`): Claude Haiku 4.5 gives the document up to 5 tags for its main topics, from our summary. It sees every existing tag with how many documents use it and its glossary definition, is told to reuse them, and creates a new tag only when none fits, since the taxonomy is still growing. Documents it can't place get `other`.
- **Weekly** (`/api/rebalance-tags`, Sundays 7am UTC, before the 9am summary): tags anything the webhook missed, then Claude Opus 5.5 merges duplicate and overlapping tags, folds one-off tags into the broader tag that covers them, and sorts out `other`. Everything is applied straight away; the plan and every before → after change (with document titles) are saved in the trace log.
- **Glossary** (`/api/tag-glossary`, Sundays 8am UTC, after the cleanup): Claude Opus 5.5 writes a one-line definition for every tag used by two or more documents (what it covers, and what it doesn't when a neighbor is close) and sorts them into 6-12 named clusters, keeping last week's where they still fit. The tagger reads the definitions. Claude Sonnet 5.5 then writes a brief for each tag with 3+ saved documents whose count changed. Reruns within 6 days only continue the briefs (`?redefine=true` redoes the definitions).
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

## /reading (public)

`nimo.fyi/reading` maps everything saved to the library: a force-directed graph of the tags used by two or more documents (size = documents, colour = cluster, links = tags that share documents), the clusters over time, and a panel per tag with its definition, brief and documents. It reads `/api/reading-graph`, which is public and cached at Vercel's CDN for an hour. Feed items and reading state never appear. The clusters and briefs show up after the first glossary run.

## /likes (private)

`nimo.fyi/likes` is a private collection of things I like: links, notes and photos, each given a title, description, category and tags by Claude Haiku 4.5 (which searches the web to identify products and places), plus a monthly email of a few old ones. Setup:

1. Set `PERSONAL_SITE_OWNER_KEY` (above). It's the password on `/likes`, and signs the tokens Claude uses; changing it signs everything out
2. Vercel → Storage → Create → Blob, with **private** access, connected to the project. On Vercel it authenticates with the project's OIDC token; `BLOB_READ_WRITE_TOKEN` is only needed to run it locally
3. Redeploy, open `/likes` and sign in with the key
4. To save from Claude: Settings → Connectors → Add custom connector → `https://nimo.fyi/api/likes/mcp`, then type the key on the page it opens. Claude can then save links and notes ("save this to my likes"), import pasted notes, and search. For a photo in a chat, Claude saves a note describing it; upload the photo itself on `/likes`

New likes are organized within a minute of saving; `/api/likes?op=process` (daily, 11am UTC) picks up anything left over, and `/api/likes?op=digest` (1st of the month, noon UTC) sends the email. Both take the cron secret:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://nimo.fyi/api/likes?op=process"
```

## Reading synthesis

`/api/reading-synthesis` runs on the 1st of each month at 10am UTC and emails a synthesis of everything saved to the library in the last 90 days, so each month's email shows the longer arc (`?days=` from 1 to 183 for a one-off over another window). The first one, over 92 days with 89 documents, took about 3 minutes. Claude Opus 5.5 gets each document's title, source, date, tags, our summary (Readwise's where we don't have one), how far you got, your notes and highlights, and the full text of as many documents as fit in about 120k tokens (shortest first), and writes: the short version, the themes across everything, how the reading changed over the window, its own meta observations, what's worth reading in full, and questions to sit with. Feed items are left out unless saved to the library. It has to finish inside the 300s function limit, so if a long window times out, use a shorter one.

## LLM trace log (Neon Postgres, free)

Every LLM call (chat, document summaries, tagging, rebalance, glossary, tag briefs, weekly summary, reading synthesis) is saved to an `llm_traces` table: the exact request, the full response, what the app did with it (tags written, rebalance changes, email subject and article ids), latency, errors, and the git commit. That's enough to replay the same inputs against another model and compare. Each row also has the token counts the API reported (`input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`) and `cost_usd`, priced with cache writes and reads at their own rates, so spend adds up directly:

```sql
SELECT kind, response_model, count(*) AS calls, sum(cost_usd) AS usd
FROM llm_traces WHERE created_at > now() - interval '7 days'
GROUP BY 1, 2 ORDER BY usd DESC NULLS LAST;
```

1. Vercel → your project → Storage → Create Database → Neon → Free plan → connect it to the project. This sets `DATABASE_URL`
2. Redeploy. The tables (`llm_traces`, `model_prices`, `documents`, `document_texts`, `tags`, `sync_state`) are created on first use
3. Query it in the Neon console's SQL editor, e.g.
   ```sql
   SELECT created_at, subject_id, result FROM llm_traces WHERE kind = 'tagging' ORDER BY created_at DESC;
   ```

Neon's free plan has 1 GB of storage and 100 CU-hours of compute a month: the database suspends after 5 idle minutes and only counts while awake, and at its smallest size (0.25 CU) 100 CU-hours is about 400 awake hours. This site wakes it for the daily sync, each save, chat messages, the weekly jobs and uncached `/reading` requests, which comes to roughly 5-10 CU-hours a month. If it ever runs out, the database is off until the next month (tagging falls back to Readwise's tag list; traces, `/reading` and summaries stop), and the Neon console shows usage under Monitoring. The first query after a suspend takes about half a second longer. Chat traces include what visitors typed (never their IP).

Neon doesn't warn before the 1 GB fills up, so the weekly email ends with a line saying how full the database is (all databases in the project, which is what Neon counts), which turns into a warning at 80%. The same line gives the week's AI spend, names any model that answered without a price (its calls would otherwise cost $0 in the log), and warns if the daily price check is failing. Measured sizes: about 3 KB per tagged document, 6 KB per chat message, and 25 KB a week for the rebalance and summary together. If it does fill, new traces stop saving and everything else keeps working; delete old chat traces (`DELETE FROM llm_traces WHERE kind = 'chat' AND created_at < now() - interval '90 days'`) or move to a paid plan.

### Model prices

`cost_usd` is worked out when each call is saved, from the `model_prices` table: one row per model per price, with the date it took effect (`effective_from`), so every call is priced at the rate that applied when it was made and later changes never rewrite history. Calls from before a model's first row use that row.

`/api/update-prices` runs daily at 5am UTC. It reads the price table and the web search price ($10 per 1,000 searches, the same for every model) on [Anthropic's pricing page](https://platform.claude.com/docs/en/about-claude/pricing) (the Markdown version), and records any new model or changed price, dated that day, then fills in the cost of earlier calls that had no price. No LLM is involved: the parser checks the table's columns, reads `$X / MTok` exactly, and leaves out rows that don't look right (output not above input, cache reads not below it). It emails you only when something changes, with a before/after table, or when the check starts failing (a layout change, or a table that looks cut short), in which case nothing is written and calls keep the last known prices. Run it by hand with:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "https://nimo.fyi/api/update-prices"
```

To correct a price by hand, insert a row with the date it took effect, then set `cost_usd = NULL` on the affected calls; the next check reprices them.

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
│   ├── readwise-webhook.ts  # Stores, summarizes (Sonnet 5.5) and tags (Haiku 4.5) new documents
│   ├── sync-documents.ts    # Daily library mirror, full texts, summary backfill (Sonnet 5.5)
│   ├── rebalance-tags.ts    # Weekly taxonomy rebalance cron (Opus 5.5)
│   ├── tag-glossary.ts      # Weekly tag definitions, clusters (Opus 5.5) and briefs (Sonnet 5.5)
│   ├── weekly-summary.ts    # Weekly reading summary cron (Opus 5.5)
│   ├── reading-synthesis.ts # Monthly 90-day synthesis cron (Opus 5.5)
│   ├── update-prices.ts     # Daily model price check (no LLM)
│   ├── reading-graph.ts     # Public data for /reading
│   ├── likes.ts             # /likes API, its MCP server and OAuth, likes crons (Haiku 4.5)
│   └── _lib/                # Shared helpers (underscore = not deployed as functions)
├── src/                     # React app
├── index.html               # Vite entry
├── vercel.json              # Framework, Fluid compute, crons
└── package.json
```

All functions use the Web standard `export default { fetch(request) }` signature. Only `/api/likes` uses Vercel packages: `@vercel/blob` for photos and `@vercel/functions` to keep organizing likes after it responds.

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
- Document summaries: `SUMMARY_MODEL`, `SUMMARY_VERSION` and `SYSTEM_PROMPT` in `api/_lib/summarize.ts`
- Tagging: `TAGGING_MODEL`, `MAX_TAGS`, and the tagging rules in `SYSTEM_PROMPT` in `api/_lib/tagging.ts`
- Glossary and briefs: `GLOSSARY_MODEL`, `BRIEF_MODEL` and their prompts in `api/_lib/glossary.ts`
- Rebalance: `PLAN_MODEL` and the taxonomy rules in `SYSTEM_PROMPT` in `api/_lib/rebalance.ts`
- Weekly summary: `SUMMARY_MODEL` in `api/_lib/summary.ts` (Claude via the Anthropic SDK)

The weekly summary and rebalance stream long Opus responses and can take a couple of minutes. Without Fluid compute, Hobby functions stop after 10s (this project predates Fluid compute, so it was off), so `vercel.json` sets `"fluid": true`, which raises the default to 300s, Hobby's maximum. (Setting `maxDuration: 300` per function as well fails the deploy with "invalid maxDuration for plan".)
