# Things I like

`/likes` is a private collection for links, notes, and photos. It shares its storage with the MCP endpoint and does not expose anything through the public reading graph.

## Deploy

Set `PERSONAL_SITE_OWNER_KEY` to a new random secret of at least 32 characters and connect a **private Vercel Blob store** to the project. On Vercel, the SDK can use the automatically supplied `BLOB_STORE_ID` and `VERCEL_OIDC_TOKEN`. A `BLOB_READ_WRITE_TOKEN` from that private store is also supported for static-token or external-worker use. Optionally set a distinct `LIKES_API_KEY` for Likes-only bearer access. Existing Likes-only installations may keep using `LIKES_API_KEY` as the owner-key fallback until the general owner key is configured. When both are set, owner login and OAuth consent/signing use the general key; the Likes key is accepted only as a bearer credential by the Likes API. Future private features should use the general owner key directly. Changing the effective owner-key value invalidates existing Likes sessions and OAuth tokens; sign in and reconnect afterward. The web UI sends the owner key only to the login or OAuth-consent form and uses an HttpOnly cookie afterward.

The site URL is inferred from Vercel’s production domain or preview branch/deployment URL. OAuth, cookies, and email links use the same resolver. `PERSONAL_SITE_ORIGIN` is only an optional override for tests or custom hosting; client-supplied Host and forwarded headers cannot change it. The legacy `LIKES_ORIGIN` override is still accepted when the general override is unset.

## MCP

Remote Streamable HTTP URL: `https://nimo.fyi/api/likes?op=mcp`.

OAuth-capable clients use discovery, PKCE, and explicit owner consent. A configured bearer client can use `Authorization: Bearer <LIKES_API_KEY>` (Likes-only access) or the general owner key in its private credential settings.

The MCP intentionally exposes four tools:

- `save_like` saves one link, note, or photo. Base64 photos are limited to about 2.8 MB; use the web upload flow for larger files.
- `save_likes` accepts either up to 100 structured captures or one raw pasted string. Raw text becomes a durable import and its original text is retained.
- `search_likes` finds saved captures.
- `get_like` retrieves a saved item or the status of a raw-import batch ID returned by `save_likes`.

Captures and imports continue automatically in bounded background batches, with the daily cron resuming unfinished work. Callers should report the returned queue status rather than requesting processing or retry operations. Structured-batch partial failures return the saved results and failing position.

Saving and enhancement are separate confirmations. `save_like` returns the durable save, current status, a plain-language message, and a private review link. The client should check `get_like` before reporting that enhancement completed and show the resulting title/category/tags. If it is still processing, it should say so and provide the review link. The server cannot push a later notification into an inactive chat. The web collection updates the visible status as processing completes.

Every capture is researched with Anthropic native web search using observable product/brand/label/descriptive cues. Photos are sent as images so the lookup can compare visible evidence with product pages; URLs also supply fetched page text and OpenGraph/Product metadata. A separate structured pass compares the original evidence with cited research, preferring manufacturer and credible product pages and distinguishing variants. Source URLs come only from actual provider search results and citations, not model-generated links. Results are labelled likely match, ambiguous, or no clear match; inferred photo identities remain suggestions. This is text-based web research guided by vision, not a separate reverse-image service. Correct title, category, tags, brand, description, or your note in the private item page; corrected fields are retained during future enhancement attempts. Original photos and text are retained separately. Save a correction and use **Search again** to research it again. No extra MCP tools or search API keys are needed. The Anthropic organization must allow web search; disabled search or tool errors produce a visible failure and retry.

Provider failures, timeouts, refusals, and invalid responses keep the original save. Enhancement retries up to three attempts, with a five-minute minimum delay and execution resumed by background processing, an open collection, or the daily cron. After the final failure the item exposes its error and a manual Retry action. A successful save is never reported as a failed capture merely because enrichment failed.

## Archives and exports

A likely matched product page for a photo or note is also archived, without replacing the original capture or photo label text. Every archive is fetched with public-address validation, DNS pinning, redirect checks, time/size limits, OpenGraph/Product metadata extraction, and a static HTML archive with embedded key images/CSS. Active scripts and remote subresources are removed. Original uploads, downloaded images, raw note text, parsed text, captures, and import sources are retained. Pages needing login, blocked requests, video, dynamic content, or missing resources may have a partial/failed archive; “complete” means the captured static version, not a working copy of the original application.

Export downloads a ZIP with `index.html`, `items.json`, `captures.json`, `imports.json`, checksummed manifest, saved text files, and actual image/archive files. Source titles, URLs, excerpts, lookup status, and available matched-page copies are included. Open the index without networking. Missing or corrupt stored files cause a clear export error rather than a successful ZIP with absent files. Exports above 100 MB must be narrowed with the UI search/category filter.

Optional screenshot worker: run `node --env-file-if-exists=.env.local --import tsx scripts/likes-screenshots.ts` on a trusted machine with Playwright Chromium installed (`npx playwright install chromium`). It renders the already saved HTML with all networking blocked, then uploads screenshots privately. `LIKES_BROWSER_CHANNEL=chrome` can use an installed Chrome. This worker is optional; the serverless capture flow does not launch Chromium.

Limits: web multipart uploads under 4 MB; MCP entire JSON body under 4 MB (base64 photos need to be smaller, approximately 2.8 MB); originals can be JPEG/PNG/GIF/WebP, PDF, or text, with image decoding capped at 25 megapixels. HEIC needs conversion to JPEG. Photo identification uses at most 5 MB of image data. Web lookup is capped at three search uses and two bounded continuations per attempt. Model requests, DNS, downloads, and attachment file I/O share cancellation deadlines; database and best-effort trace operations retain their existing behavior. Job leases fence final item updates. Trace cost includes provider-reported web-search charges ($0.01 per search plus tokens, per Anthropic documentation). Static archives are capped at 20 MB and may preserve only four images/two stylesheets. These limits are surfaced instead of silently discarding input.

## Resurfacing

Weekly digest is **off by default**. Enable it in `/likes` and choose 1–10 items. Sunday's 09:30 UTC cron selects saves at least seven days old, preferring items never shown or shown longest ago; dismissed and snoozed items are excluded. Existing `reader@nimo.fyi`, recipient, and Resend credentials are reused. Emails link back to the private item and include your own note when present. Delivery uses a weekly lease and Resend idempotency key; `last_shown_at` changes only after successful delivery.

For counts/selection without sending, call `/api/likes?op=digest&dry_run=true` with the existing cron bearer secret. No implementation test sends a real email.

## Local verification

```sh
npm run build
npm run lint
npm run test:likes
npm run test:likes:browser
```

Backend tests use isolated PGlite databases, private local files, mocked Anthropic/Resend calls, and the official MCP SDK. Browser tests start a local API plus Vite with synthetic notes and a mocked AI provider. They exercise login, capture, photo upload, backfill, search, export, logout, and responsive layouts. Production Blob, provider/account connections, and real email delivery require a configured deployment.

For local interactive work, run the API with `PERSONAL_SITE_ORIGIN=http://localhost:5173 npm run likes:dev`, and Vite with `LIKES_API_PROXY=http://127.0.0.1:3001 npm run start:web`. Set the existing Anthropic key only if you want live enrichment. The local server creates an isolated local database/file store and uses a development-only owner key; its mock provider runs only when explicitly enabled with `LIKES_DEV_MOCK_AI=1`. None of these local settings are allowed in a deployed Vercel function.
