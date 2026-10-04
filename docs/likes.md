# Things I like

`/likes` is a private collection for links, notes, and photos. It shares its storage with the MCP endpoint and does not expose anything through the public reading graph.

## Deploy

Set `LIKES_API_KEY` to a new random secret of at least 32 characters and connect a private `BLOB_READ_WRITE_TOKEN`. The owner key is sent only to the login or OAuth-consent form; the web UI uses an HttpOnly cookie afterward.

The site URL is inferred from Vercel’s production domain or preview branch/deployment URL. OAuth, cookies, and email links use the same resolver. `LIKES_ORIGIN` is only an optional override for tests or custom hosting; client-supplied Host and forwarded headers cannot change it.

## MCP

Remote Streamable HTTP URL: `https://nimo.fyi/api/likes?op=mcp`.

OAuth-capable clients use discovery, PKCE, and explicit owner consent. A configured bearer client can use `Authorization: Bearer <LIKES_API_KEY>` in its private credential settings.

The MCP intentionally exposes four tools:

- `save_like` saves one link, note, or photo. Base64 photos are limited to about 2.8 MB; use the web upload flow for larger files.
- `save_likes` accepts either up to 100 structured captures or one raw pasted string. Raw text becomes a durable import and its original text is retained.
- `search_likes` finds saved captures.
- `get_like` retrieves a saved item or the status of a raw-import batch ID returned by `save_likes`.

Captures and imports continue automatically in bounded background batches, with the daily cron resuming unfinished work. Callers should report the returned queue status rather than requesting processing or retry operations. Structured-batch partial failures return the saved results and failing position.

Saving and enhancement are separate confirmations. `save_like` returns the durable save, current status, a plain-language message, and a private review link. The client should check `get_like` before reporting that enhancement completed and show the resulting title/category/tags. If it is still processing, it should say so and provide the review link. The server cannot push a later notification into an inactive chat. The web collection updates the visible status as processing completes.

Photos are classified from the uploaded image, visible label text, and your note; there is no product web search or reverse-image lookup. URLs supply fetched page text and OpenGraph/Product metadata. Inferred photo identities remain suggestions. Correct title, category, tags, brand, description, or your note in the private item page; corrected fields are retained during future enhancement attempts. Original photos and text are retained separately.

Provider failures, timeouts, refusals, and invalid responses keep the original save. Enhancement retries up to three attempts, with a five-minute minimum delay and execution resumed by background processing, an open collection, or the daily cron. After the final failure the item exposes its error and a manual Retry action. A successful save is never reported as a failed capture merely because enrichment failed.

## Archives and exports

Each link is fetched with public-address validation, DNS pinning, redirect checks, time/size limits, OpenGraph/Product metadata extraction, and a static HTML archive with embedded key images/CSS. Active scripts and remote subresources are removed. Original uploads, downloaded images, raw note text, parsed text, captures, and import sources are retained. Pages needing login, blocked requests, video, dynamic content, or missing resources may have a partial/failed archive; “complete” means the captured static version, not a working copy of the original application.

Export downloads a ZIP with `index.html`, `items.json`, `captures.json`, `imports.json`, checksummed manifest, saved text files, and actual image/archive files. Open the index without networking. Missing or corrupt stored files cause a clear export error rather than a successful ZIP with absent files. Exports above 100 MB must be narrowed with the UI search/category filter.

Optional screenshot worker: run `node --env-file-if-exists=.env.local --import tsx scripts/likes-screenshots.ts` on a trusted machine with Playwright Chromium installed (`npx playwright install chromium`). It renders the already saved HTML with all networking blocked, then uploads screenshots privately. `LIKES_BROWSER_CHANNEL=chrome` can use an installed Chrome. This worker is optional; the serverless capture flow does not launch Chromium.

Limits: web multipart uploads under 4 MB; MCP entire JSON body under 4 MB (base64 photos need to be smaller, approximately 2.8 MB); originals can be JPEG/PNG/GIF/WebP, PDF, or text, with image decoding capped at 25 megapixels. HEIC needs conversion to JPEG. Photo identification uses at most 5 MB of image data. Static archives are capped at 20 MB and may preserve only four images/two stylesheets. These limits are surfaced instead of silently discarding input.

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

For local interactive work, run the API with `LIKES_ORIGIN=http://localhost:5173 npm run likes:dev`, and Vite with `LIKES_API_PROXY=http://127.0.0.1:3001 npm run start:web`. Set the existing Anthropic key only if you want live enrichment. The local server creates an isolated local database/file store and uses a development-only owner key; its mock provider runs only when explicitly enabled with `LIKES_DEV_MOCK_AI=1`. None of these local settings are allowed in a deployed Vercel function.
