# Things I like

Private collection at `/likes`, accepting URLs, free-text notes, and photos. The same backend serves the web UI and the MCP. Backfill by pasting notes into chat; no Apple Notes integration or access to a local Notes library is required.

## Deploy

The existing Neon, Anthropic, Resend, and cron credentials are reused. Configure three new server-side settings in Vercel for the intended environment before publishing:

- `LIKES_API_KEY`: a new random secret of at least 32 characters; generate with `openssl rand -hex 32` and save securely. It is the owner login key, optional direct MCP bearer credential, and signing secret. Never put it into frontend code or a URL. Changing it revokes owner sessions and OAuth tokens.
- `LIKES_ORIGIN`: the exact site origin, normally `https://nimo.fyi`. For a preview, use its own origin. This controls cookie checks, OAuth issuer/resource, callbacks, and email links.
- `BLOB_READ_WRITE_TOKEN`: connect a **private** Vercel Blob store. Uploads fail closed without private storage; a public store is intentionally unsupported.

Likes creates its own additive tables on first authenticated use. The schema is in `api/_lib/likes-schema.ts`; it does not insert into the Readwise mirror or the public `/reading` data. Review this schema before enabling credentials against production. Rolling back the deployment leaves saved records/files intact.

Deploy the branch, then visit `/likes` at the configured origin and sign in with the owner key. The credential is sent only to the site login endpoint; the browser then uses a signed HttpOnly SameSite cookie and does not keep the key in localStorage.

Capture/import processing starts after saves via Vercel `waitUntil`, continues in bounded batches through the UI or MCP, and has a daily 11:00 UTC cron fallback. Work is stored in Postgres with leases and retries, rather than depending on a browser remaining open. A failed or incomplete archive is visible and retryable. No test run applies the schema to production.

## Connect the MCP

Remote Streamable HTTP URL: `https://nimo.fyi/api/likes?op=mcp` (replace the origin for a preview).

For Claude/ChatGPT/Codex clients that use OAuth, add that URL as a custom connector. The server exposes discovery, public client registration, explicit owner consent, PKCE S256, short-lived audience-bound access tokens, and rotating refresh tokens. On the authorization page, check the displayed client and callback and enter the owner key to approve. Previously approved OAuth clients cannot approve a new client themselves. Unapproved registrations expire after one hour; repeat identical registrations reuse the same client ID.

For a client supporting configured bearer headers, set `Authorization: Bearer <LIKES_API_KEY>` in its private credential settings, not in a prompt. Codex CLI also supports a bearer token environment variable:

```sh
codex mcp add nimo-likes --url 'https://nimo.fyi/api/likes?op=mcp' --bearer-token-env-var LIKES_API_KEY
```

The protocol is tested with the official SDK over the actual HTTP handler. Connecting a real account still requires the configured deployment and approval in the chosen client.

Tools include `save_like`, `save_likes`, `import_notes`, `get_import`, `retry_import`, `search_likes`, `get_like`, `update_like`, `retry_like`, `process_pending_likes`, and `get_profile`. Destructive deletion and arbitrary SQL are not exposed.

Example requests:

- “Save this product URL. I liked its construction.”
- “Import everything below into things I like. Keep my wording and why I liked each item.” Paste up to 100,000 characters of notes; URLs in the extracted entries become links and are archived.
- “Show the status of that import, then process any pending saves.”
- “Find the woody perfumes I saved.”

`import_notes` returns a durable batch ID immediately. Query `get_import` for progress or use `process_pending_likes` to continue immediately. Original pasted text and per-item captures remain available in exports. Parsing checkpoints each roughly 6,000-character fragment so long backfills can span several runs; retries reuse completed fragments, durable parsed results, and stable capture keys. `save_likes` accepts up to 100 structured items; if an item fails it reports the stopping position, and callers should reuse their idempotency key on retry. Supplied title/category/tags are preserved against later model suggestions.

Photos can be uploaded in the web UI, or passed as `photo_base64` with a matching `photo_content_type` and filename to `save_like` when the client can transfer actual file bytes. A picture displayed in chat is not automatically a tool-readable file. The upload is saved privately before identification; generated product IDs remain suggestions.

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
