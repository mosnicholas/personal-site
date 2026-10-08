# Personal Site - Code Structure & Context

## Project Overview
Personal site for Nicholas Moschopoulos (nimo), live at nimo.fyi. Six parts:

1. **Landing page** - "nicholas moschopoulos" scrambles in, becomes a glitching "nimo", and the tagline streams in like an LLM response.
2. **Terminal mode** (`?mode=terminal`, or press `~`/`t` on the landing page) - retro boot sequence, then a chat with a Claude-powered assistant about nimo.
3. **Reading workflows** (migrated from n8n) - a Readwise webhook that summarizes and tags new documents, a daily sync that mirrors the library into Postgres, weekly crons that rebalance the taxonomy, write a tag glossary, and email a summary of the week's reading, and a monthly cron that emails a longer synthesis.
4. **Reading map** (`/reading`, public) - a force-directed map of the tags, clustered, with a timeline and per-tag briefs, served from the mirror.
5. **Likes** (`/likes`, private, just for nimo) - links, notes and photos he likes or wants to try, organized by Haiku, saved from the page, the iPhone share sheet, a Mac menu bar app or over MCP, with a monthly email resurfacing old ones.
6. **MCP server** (`/api/mcp`, private) - lets Claude and ChatGPT save likes and search and read both likes and the reading mirror.

## Tech Stack
- **React 19.3** + **TypeScript 6.0** (strict), vanilla CSS
- **Vite 8** for dev server and build (migrated from the deprecated Create React App)
- **Vercel** for hosting; `/api/*.ts` are Vercel Functions
- **Node 24 LTS** (`.nvmrc`), **npm** (`package-lock.json`)
- **Anthropic SDK** for all AI: `claude-haiku-5-5` for terminal chat (thinking off, `low` effort), tagging (`low` effort) and likes, `claude-sonnet-5-5` for document summaries and tag briefs, `claude-opus-5-5` for the weekly tag rebalance, glossary and summary, and the monthly synthesis
- **Neon Postgres** (`@neondatabase/serverless`, `DATABASE_URL`) for the LLM trace log and dated model prices, the library mirror with each saved document's full text and our summary, and the tag glossary
- **Vercel Blob** (private store; OIDC on Vercel, `BLOB_READ_WRITE_TOKEN` locally) for likes photos; `@vercel/functions` for `waitUntil`
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
│   ├── App.tsx                # Picks Landing, TerminalMode, or the lazy-loaded /reading or /likes page from the URL
│   ├── components/
│   │   ├── TextScrambler.tsx  # Scramble animation, fires onComplete after holdMs
│   │   ├── StreamingText.tsx  # Char-by-char reveal
│   │   ├── Tagline.tsx        # "adventurer, cook, and founder of Junior" + link
│   │   ├── TerminalMode.tsx   # Boot sequence (staged timeouts) then chat
│   │   ├── ChatInterface.tsx  # Terminal chat UI, POSTs to /api/chat
│   │   ├── reading/           # /reading: tag map, cluster legend, timeline, tag panel
│   │   └── likes/             # /likes: sign in, capture, import, grid, edit panel
│   ├── hooks/useScrambledText.ts
│   └── utils/textScramble.ts  # Scramble algorithm
├── api/
│   ├── chat.ts                # Terminal assistant (system prompt lives here)
│   ├── readwise-webhook.ts    # Summarizes and tags new Readwise Reader docs, mirrors them
│   ├── sync-documents.ts      # Daily 6am UTC cron: mirror the library, write missing summaries
│   ├── rebalance-tags.ts      # Sunday 7am UTC cron: rebalance the taxonomy
│   ├── tag-glossary.ts        # Sunday 8am UTC cron: define and cluster tags, write tag briefs
│   ├── weekly-summary.ts      # Sunday 9am UTC cron: email the reading summary
│   ├── reading-synthesis.ts   # 1st of the month 10am UTC cron: email a synthesis of the last 90 days
│   ├── reading-graph.ts       # Public, CDN-cached data for /reading
│   ├── update-prices.ts       # Daily 5am UTC cron: record model price changes from Anthropic's pricing page
│   ├── likes.ts               # /likes API and the likes crons (daily leftovers, Sunday realign, monthly email)
│   ├── mcp.ts                 # The MCP server and its OAuth endpoints (rewritten here as ?op=)
│   ├── tsconfig.json          # Node/ESM config; Vercel also uses it to compile /api
│   └── _lib/                  # Helpers; underscore keeps Vercel from deploying them as functions
│       ├── anthropic.ts       # Shared Anthropic client (checks ANTHROPIC_API_KEY)
│       ├── auth.ts            # Constant-time secret comparison, cron auth
│       ├── db.ts              # Shared Neon client; creates all tables on first use
│       ├── documents.ts       # The mirror: `documents` (upserts, our summaries, tag counts), `document_texts`, sync state
│       ├── email.ts           # Resend client
│       ├── glossary.ts        # Opus definitions + clusters, Sonnet tag briefs (`tags` table)
│       ├── likes.ts           # The `likes` table and photos in Blob: list, search, save, edit, claim for enrichment
│       ├── likes-enrich.ts    # Haiku fills in title/description/category/tags (web search for photos and notes); splits pasted notes
│       ├── likes-realign.ts   # Weekly Opus realign of every like's category and tags
│       ├── owner-auth.ts      # Owner key: session cookie, bearer, and a stateless OAuth server for MCP clients
│       ├── mcp.ts             # Minimal MCP server (save, update, search, get) over likes and reading, no SDK
│       ├── likes-digest.ts    # Monthly email of a few old likes
│       ├── graph.ts           # Queries behind /api/reading-graph
│       ├── pricing.ts         # Dated model prices (`model_prices`), price lookup, the cost of a call from its usage
│       ├── prices-check.ts    # Daily check of Anthropic's pricing page: parse, diff, record changes, fill missing costs
│       ├── rate-limit.ts      # In-memory per-instance rate limiter for /api/chat
│       ├── readwise.ts        # Readwise Reader v3 client (list, tags, bulk update)
│       ├── rebalance.ts       # Weekly rebalance: sweep, Opus plan, bulk rewrite
│       ├── summarize.ts       # Our document summaries (Sonnet 5.5, full text, length set by the document) + HTML to text
│       ├── summary.ts         # Weekly summary via Claude Opus 5.5 (streaming); parses SUBJECT + HTML
│       ├── sync.ts            # Resumable library listing and summary backfill
│       ├── synthesis.ts       # Monthly/one-off synthesis prompt and request (Opus 5.5)
│       ├── tagging.ts         # Haiku tagger: reuses existing tags, creates new ones when needed
│       ├── taxonomy.ts        # `other` tag, tag normalization, cached tag list with counts and definitions
│       └── traces.ts          # Saves every LLM call to Postgres (`llm_traces`), and other events (`event_log`)
├── shared/likes.ts            # The Like type, shared by the API and /likes
├── docs/save-to-likes-shortcut.plist  # The iPhone share-sheet shortcut that saves a like (source; sign it to install)
├── mac/                       # Likes.app, the Mac menu bar app that saves likes (SwiftUI, Swift package; mac/build.sh)
├── scripts/eval/             # Summary eval: pick documents, write candidates, judge (API or Claude Code agents), report; see its README
├── vite.config.ts
├── eslint.config.js
├── tsconfig.json              # References tsconfig.app.json, tsconfig.node.json, api/
├── vercel.json                # framework: vite, fluid: true (300s functions), /reading and /likes rewrites, OAuth paths, crons
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

### Library mirror and our summaries
- Readwise is the source of truth for documents, reading state and tags; Postgres keeps a mirror (`documents`) so everything else can read without Readwise's 20 requests/min limit
- The mirror is kept fresh by the daily sync (resumable listing from the last complete sync, page cursor in `sync_state`), the webhook (upserts on save) and the rebalance (writes tags it applied)
- Each saved document's full text (HTML from `withHtmlContent`, converted to plain text, up to 1M chars) is stored in `document_texts`, apart from `documents` on purpose: texts are ~90% of the bytes, they stay out of every metadata query, and the table can later move to blob storage (e.g. S3) to save Postgres space without touching anything else. The user prefers one table in principle but chose this for that reason. Feed items get neither text nor our summary (cost)
- Our summaries (`summary`) are written by Sonnet 5.5 at `medium` effort from the stored text (up to 600k chars). The prompt is short and says what summaries are for (recall what a piece said, decide what to read in full, tag and connect documents) and leaves length to the model; the user doesn't want length rules or word counts in it. `/5` adds that the reader skims (lead with the main point, structure that fits: short paragraphs or a list), because `/4` wrote one dense paragraph; summaries are Markdown-ish text (bold labels, `-` bullets), which every consumer passes to a model as-is. An earlier prompt (`/2`) said the summary "stands in for the document" and listed everything to include, and got full-length paraphrases of short posts. `/4` stopped asking for key points, which repeated the summary; `key_points` is empty for new summaries and consumers treat it as optional. Documents of 300 words or fewer (tweets, short threads) are their own summary, with no model call (`VERBATIM_MAX_WORDS`): tested on 35 documents, `/4` cut total output to 44% of `/2` and ran 4-21% of the document above ~800 words, but stayed at 50-85% on posts under ~400 words, and giving it the word count changed nothing. The user picked 300 over 500 `summary_model` stores `SUMMARY_VERSION` (model + prompt version); bump it when changing the prompt or model. A new version only applies to new summaries: the user doesn't want prompt iterations to rewrite the library, so existing summaries are only regenerated on purpose, with `?redo=true` on `/api/sync-documents` (repeat until `incomplete` is false; about $6 for the library). The webhook writes one on save when the text is ready; the daily sync fills in any that are missing, 3 attempts per document
- Consumers: the weekly summary and the synthesis get full texts within a character budget (`WEEKLY_TEXT_BUDGET_CHARS`, `SYNTHESIS_TEXT_BUDGET_CHARS`; shortest documents first) and our summaries for the rest; tagging, the rebalance and tag briefs use our summaries. Every consumer falls back to Readwise's summary

### Tag taxonomy (knowledge graph)
- Readwise is the source of truth: the taxonomy is the set of tags in use, normalized to lowercase kebab-case
- The taxonomy is still being created, so the save-time tagger (Haiku 5.5) may create tags: it sees every existing tag as `name (documents): definition` (from the mirror and the glossary), is told to reuse them, and creates one only when none covers a main topic. `other` is for documents it can't place. Don't swap in a closed-set classifier (decision models like Jev) while tags are still being created
- Weekly glossary (`tag-glossary.ts`, after the rebalance): Opus 5.5 at `low` effort defines every tag used by 2+ documents (top 250, to stay inside 300s) in at most 15 words and sorts them into 6-12 named clusters, keeping last week's unless wrong; it's skipped if under 6 days old (`?redefine=true` forces it). Sonnet 5.5 writes a public brief for each tag with 3+ saved documents whose count changed or whose documents were resummarized since
- Weekly, Opus 5.5 returns a structured plan (`merges`, `other_documents`), merging synonyms and one-off tags (used by 1-2 documents) into the tag that covers them; code validates it (no merging into/out of `other`, only known tags and documents) and rewrites tags with Readwise's bulk update
- Earlier runs' merges (`loadAppliedRenames()`, read from rebalance traces, newest wins) are passed to Opus as `earlier_merges`, applied to returning retired tags, and used to resolve plan targets, so a plan can't reverse an earlier merge

### Likes (`/likes`)
- For nimo alone: keep it simple. No multi-user machinery, idempotency keys, delivery leases, export, or "untrusted input" prompt rules
- One table, `likes` (created in `db.ts`); a like can have several photos (`photos`, the first is the cover), each a private Vercel Blob (JPEG, resized to 2048px in the browser or the shortcut to stay under Vercel's 4.5 MB request limit) streamed back through `?op=photo&n=`. Several photos go up one request each: the first saves the like, the rest are added to it
- Saving answers right away; enrichment runs after the response (`waitUntil`) and daily at 11am UTC for leftovers. Haiku 5.5 gets the link's fetched page (og: title, description, text), the text and note, and the first 4 photos (photos added after the save, like the shortcut's 2nd and later, usually arrive after it has run). First it searches the web and says what the like is, with up to 10 searches (resuming paused turns, 6 requests at most; thinking off, default `medium` effort). Haiku 5.5 thinks by default, but forced tool calls (`save_details`, the picture pick) skip it; splitting notes runs at `low` effort. It searches even when it knows what the thing is, because the results are where sources and pictures come from. Then, given that answer and the search results' URLs and titles but no search tool, it fills in the details with a forced strict `save_details` call, picking the results about it as sources (only real results are kept). They're separate requests because after a search Haiku cites as it writes: in a tool call that came out as `<cite>` markup around a few quoted words instead of a description. Last, the image: candidates are the og:image and first `<img>`s (the largest `srcset` version) of the linked page and of up to 5 sources, since many stores' og:image is a logo or missing; files under 3 KB are dropped and at most 16 pictures (15 MB) are shown; Haiku looks at them and says which show the thing (in the version the note singles out), and the biggest file of those wins. Preview images can be the site's own picture (curated.supply), a page that redirected (Heal's shows a sofa for a discontinued clock), or a 265px thumbnail (twentieth.net). If Haiku picks none, there's no image; if the pick request fails, it's the linked page's og:image or nothing (most candidates are just pictures on a page). Image types are read from the file's first bytes, not the server's Content-Type, which some servers get wrong (a PNG sent as image/jpeg made the API reject the whole request). The category is the broad kind of thing (furniture) and tags narrow it down (chair, counter stool), for browsing; Haiku sees each category with its count, latest 3 titles and 10 most used tags (`likeCategories()`), reuses them when they fit and starts a new category when none does (with only the names it filed films under Art and Performing Arts); brand and materials belong in the title and description (the first tags, like `bensen`, `wood`, `bar stool`, were noise to me). `CATEGORY_DESCRIPTION` / `TAGS_DESCRIPTION` say so to Haiku and to Claude over MCP. Enrichment fills only empty fields (the image and sources too), so anything I set (or Claude set over MCP) stays. Haiku still runs when every field is filled: a shortcut that skipped it left 182 backfilled likes with no link, no sources and no picture. Failures retry after 5 minutes, 3 tries
- "Organize again" (`?op=redo`, or `update` with `reorganize` over MCP) clears what Haiku wrote and runs it again from the note and photos, e.g. to point it at one variant of a product page. Photos can be added later (`?op=photo`, POST) or removed (DELETE with `n`); photo URLs carry a version (`v`) so browsers can cache them
- Saving a link that's already saved returns the existing like, with the list and review from that save if it gave them (sharing it again after going)
- `list` is where I stand with a like, in free text: so far `want to try` or `been` (stored lowercase; null when it's just something I like). `review` is what I thought, shown on the page once the list is `been`. Haiku doesn't set either. Migration 6 set the list of the backfilled likes from the old list named in their text (places, restaurants and events to try; favorite restaurants and best shows); the rest are unset
- The share-sheet shortcut (`docs/save-to-likes-shortcut.plist`) takes a link, text, Maps place or photos, asks want to try / been (and how it was) / just save it, then who recommended it or why, and posts it to `/api/likes` with the owner key as a bearer. Photos are used only when there's no link; each is resized (2048px long edge, JPEG) and posted on its own, the first as the like, the rest to `?op=photo`. Edit the plist with a script (Python plistlib) rather than by hand; Form file fields are `WFItemType` 5. The key is asked for on import, so the file has no secret. To install: `plutil -convert binary1 -o /tmp/s.shortcut docs/save-to-likes-shortcut.plist && shortcuts sign --mode anyone -i /tmp/s.shortcut -o "Save to Likes.shortcut"`, then open it on the Mac or iPhone
- The Mac menu bar app (`mac/`, SwiftUI in an `NSPopover` on an `NSStatusItem`, not `MenuBarExtra`, which closes when another app is touched so nothing could be dragged in from the browser; the popover closes on a plain click elsewhere but not when a drag starts, and dragging onto the heart opens it, or saves what is dropped on the heart; macOS 14+, built with `mac/build.sh` from the command line tools alone, no Xcode; `--install` copies it to /Applications): drop or paste (⌘V) links, photos or text, or click to choose photos; then the same questions as the shortcut (Like / Want to try / Been, why, how was it) and Save. Same rules as the shortcut: each link is its own like, photos without a link are one like (resized to 2048px JPEG, one request each), text goes along. Below the drop zone, the 8 newest likes with their picture and status, refreshed every 4s while one is organizing; a row opens `/likes?item=`, its arrow the link. The owner key is in the login keychain. Signed ad hoc, so it only runs on the Mac that built it
- Weekly realign (`likes-realign.ts`, Sunday 9:30am UTC, `?op=realign`; the owner can POST it, with `&dry_run=true` to only see the changes): Haiku organizes each like on its own, so categories drift (films under Art, 786 distinct tags for 230 likes, `michelin star` next to `michelin-starred`). Opus 5.5 at `medium` effort sees every ready like (title, description, category, tags, numbered instead of ids), first settles the set of categories with a description of each (merging overlapping ones, splitting catch-alls), then returns the likes whose category or tags should change, with their full new values. The first run, at `low` and without the category step, moved 33 likes but left the category set as it was (Design Inspiration, Ideas next to Project Ideas, Live Music next to Events). The categories and descriptions are saved in `sync_state` (`likes_categories`) and Haiku sees each description next to its category when it organizes a new like; they're applied directly, like the reading rebalance, and the trace (`likes_realign`) keeps each change, before → after, as the undo log. It can change categories and tags I set myself
- Pasted notes are split by Haiku (structured output) in ~8k-character pieces; a piece that fails is saved whole
- Auth (`owner-auth.ts`, shared with the MCP server): `PERSONAL_SITE_OWNER_KEY` signs in on the page (30-day HttpOnly cookie), works as a bearer token, and signs OAuth codes and tokens (HMAC, purpose-bound, no tables). Changing the key signs everything out
- Monthly email (1st, noon UTC): 5 ready likes saved over 30 days ago, least recently emailed first, via `sendReadingEmail`

### MCP server (`/api/mcp`)
- For Claude and ChatGPT connectors: OAuth discovery (`/.well-known/...`), dynamic registration (anyone may register; I approve by typing the key on the consent page), PKCE, 1-day access and 90-day refresh tokens, all stateless signed tokens
- Hand-written JSON-RPC (stateless, JSON responses, no SSE), not the MCP SDK (~100 dependencies). Tools are entries in `TOOLS`; add a source by adding tools or results there
- Four tools: `save` (a like, with title, description, category and tags when the client already knows them; `photo` is a ChatGPT file param, `_meta["openai/fileParams"]`, or any public image URL, fetched and resized to JPEG by Blob `putImage`, which needs Vercel's OIDC), `update` (a like's fields, including `list` and `review`, or a photo to add; `reorganize` reruns enrichment, keeping what the call sets), `search` (likes and saved reading, newest first, every word must match, `source` and `since` filters; up to 100 per source a page, with `nextOffset` for the next one, so a client can read everything), `get` (a like with up to 10 photos as images, or a saved document with its summary and up to 100k chars of text). Feed items aren't included. Claude can't pass chat images to tools, so photos from Claude only work as URLs

### LLM traces
- Every LLM call goes through `tracedCall` / `recordTrace` in `api/_lib/traces.ts`: kind (`chat`, `tagging`, `document_summary`, `rebalance`, `likes_realign`, `tag_glossary`, `tag_brief`, `weekly_summary`, `reading_synthesis`, `likes_enrichment`, `likes_import`), subject id (Readwise document id for tagging, run date for weekly jobs), exact request params, full response, the app's result, latency, error, `VERCEL_GIT_COMMIT_SHA`
- Token usage as reported by the API is stored in columns: `response_model` (the model that answered), `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`, and `cost_usd` computed at write time from the `model_prices` table (input, 5-minute and 1-hour cache writes, cache reads, output and web searches each at their own rate)
- `model_prices` has one row per model per price with `effective_from` (`web_search` is USD per 1,000 searches, the same for every model; `long_prompt` holds higher token prices for prompts over `above` tokens, input plus cache writes and reads: Haiku 5.5 is $0.10/$0.50 up to 100,000 tokens and $0.50/$2.50 over, listed as two rows on the pricing page that the check reads into one); `priceAt` picks the latest row in effect at the call's time (the earliest row for calls before it), matching the model ID exactly after dropping a date suffix (`claude-opus-5` must not price `claude-opus-5-5`). `SEED_PRICES` in `pricing.ts` only seeds the table. `update-prices.ts` (daily) parses the Markdown pricing page with no LLM (the model table, plus the web search price from its prose), records new models and changed prices dated today, emails a diff when anything changed or when the check starts failing, and fills `cost_usd` for calls that had no price. Costs assume standard rates (no batch, fast mode or `inference_geo`); if one of those is used, the pricing needs a multiplier
- Schema changes to existing tables go in `MIGRATIONS` in `api/_lib/db.ts` (run once each; the applied version is in `sync_state` as `schema`)
- Rebalance traces also store every applied change (`id`, `title`, `before` → `after` tags), which is the undo log, and `renames`, which later runs build on
- Neon's free plan stops writes at 1 GB (all databases in the project) without warning, so the weekly email ends with `describeTraceLog()`: size and % of 1 GB (a warning from 80%), call count, the last 7 days' AI spend, a warning naming any model with no price, and a warning if the daily price check is failing or hasn't run for 3 days
- Tracing never breaks the caller; without `DATABASE_URL` it's skipped. New LLM calls should be traced too
- `event_log` (`logEvent` in `traces.ts`) records what happens outside LLM calls, so it can be checked later from the database (Vercel's logs need the owner's login). Subject id and detail by kind:
  - `cron_run`: the job (`sync-documents`, `likes-digest`, ...); a `started` row, then a `finished` row with the status, ms and the JSON the job returned. A start with no finish timed out. Every cron is wrapped in `loggedCron`; requests with the wrong method or secret aren't logged
  - `email`: Resend's id; sender name and subject, or the error (`sendReadingEmail` sends every email)
  - `mcp_call`: the tool; the app (User-Agent), its arguments, the result in brief (counts, ids, titles) and ms, or the error
  - `readwise_save`: the new document's id, or the error
  - `readwise_webhook`: the document; event type, title and outcome (`tagged`, `skipped`, `unauthorized`, `failed`, ...)
- A `readwise_save` whose id never shows up as a delivery means Readwise didn't send the webhook for it; it's not yet known whether Readwise sends webhooks for documents saved through its API (the weekly summary saves itself that way)

### API functions
- All use the Web standard `export default { fetch(request: Request) }` signature - no `@vercel/node`
- `chat.ts`: takes `{ messages: [{ role, content }] }`, validates it (user turns <= 500 chars, last 20 kept, must end on a user turn), calls Claude Haiku 5.5, returns `{ response }`; errors return `{ error }` without internal details. Rate limited per instance: 10/min per IP, 200/hour overall (see DEPLOY.md for the free WAF rule and Anthropic spend cap)
- `readwise-webhook.ts`: only handles `*document.created` events to avoid loops (anything else gets a 200 `skipped`, no secret needed); acts only with a matching `READWISE_WEBHOOK_SECRET` (Readwise sends it as `secret` in the body), and answers 200 without acting while it's unset, because Readwise won't create the webhook (and reveal the secret) until its endpoint test passes; tags the document via `classifyDocument` against the current taxonomy and replaces its tags (the user never tags by hand)
- `rebalance-tags.ts`: same cron auth; `?days=` (default 8) sets how far back to look for untagged documents, so a big value backfills. Applies changes directly, no review step. Works within a ~220s time budget and reports `incomplete` if it stopped early; it's idempotent, so the next run continues. The sweep lists each location a page at a time (library first, then the feed, which can hold thousands of items against a 20 requests/min limit), tags as it goes, and skips the Opus plan until nothing is left untagged
- `weekly-summary.ts`: requires `Authorization: Bearer $CRON_SECRET` (Vercel cron sends this; `rejectUnauthorizedCron` in `_lib/auth.ts`); `?days=` (1-31), `?email=false`, `?save=false` for manual runs. It summarizes documents saved or opened in the window, not everything updated: rewriting tags can bump `updated_at` on old documents. The summary is written by Claude Opus 5.5 at `medium` effort with server-side refusal fallbacks (`fallbacks: "default"`)
- `sync-documents.ts`: same cron auth; ~220s budget, half for listing; `?summarize=false` lists only; `?limit=N` writes at most N summaries (newest saves first); `?redo=true` also rewrites summaries from an older `SUMMARY_VERSION` (otherwise it only writes missing ones). Reports `incomplete` until the listing is caught up and every saved document has a summary from the current version
- `tag-glossary.ts`: same cron auth; definitions, then briefs until the budget runs out (`incomplete` while briefs remain)
- `update-prices.ts`: same cron auth; `?email=false`. Last outcome in `sync_state` as `price_check`
- `reading-graph.ts`: public, no auth, `Cache-Control: s-maxage=3600, stale-while-revalidate=86400`. Without params: tags on 2+ saved documents (count, cluster, definition), clusters, edges (tag pairs sharing 2+ documents), 52-week timeline by cluster. `?tag=<name>`: definition, brief, up to 200 documents (title, site, original URL, saved date). Saved documents only, never reading state
- `reading-synthesis.ts`: same cron auth; `?days=` (default 90, so each monthly email covers a quarter; max 183), `?email=false`, `?dry_run=true` (counts and approximate input tokens, no model call). Covers documents saved to the library (`new`, `later`, `shortlist`, `archive`) in the window, with their highlights; one Opus 5.5 call at `medium` effort writes themes, change over time, meta observations, what to read, and questions. It must finish within 300s, so the prompt asks for ~3,000 words

## Development

```bash
nvm use && npm install
npm install -g vercel   # once; needed for npm start
npm start               # vercel dev: site + API (needs .env, see .env.example)
npm run start:web       # Vite only, no API
npm run build           # tsc -b (src + api) then vite build -> dist/
npm run lint
npm run format
npm run eval:pick -- <run>   # then eval:summarize, eval:judge (or eval:agents), eval:report; see scripts/eval/README.md
```

### Verifying changes
- `npm run build` must pass - it type-checks the frontend and the API, and Vercel runs it on deploy
- `npm run lint` should be clean
- No test suite
- Before changing the summary prompt or model, run the summary eval (`scripts/eval/`) on a fresh run and compare against `stored`; it uses `summaryRequest()` from `api/_lib/summarize.ts`, so it tests the exact production request. Run data (`scripts/eval/runs/`) holds full texts and is gitignored; never commit it (the repo is public)

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
- **Reading models**: `SUMMARY_MODEL` in `api/_lib/summarize.ts` (document summaries), `PLAN_MODEL` in `api/_lib/rebalance.ts`, `GLOSSARY_MODEL` / `BRIEF_MODEL` in `api/_lib/glossary.ts`, `SUMMARY_MODEL` in `api/_lib/summary.ts` (weekly email)
- **Chat rate limits**: `perIpLimit` / `overallLimit` in `api/chat.ts`
- **Likes**: `SYSTEM_PROMPT` / `SPLIT_PROMPT` in `api/_lib/likes-enrich.ts`; MCP tools and instructions in `api/_lib/mcp.ts`; email in `api/_lib/likes-digest.ts`

## Follow-up work
- `docs/plans/align-document-summaries.md`: evaluate document summaries (faithfulness, coverage, length, usefulness) with calibrated LLM judges, then pick or distill the summarizer. Not started; read it before changing `SUMMARY_MODEL` or the summary prompt

## Commit Style
- Descriptive commit messages that explain "why", not just "what"
- Reference specific files changed
- Note bundle size impacts
