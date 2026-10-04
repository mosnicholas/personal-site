import { rejectUnauthorizedCron } from './_lib/auth.js';
import { requireSql } from './_lib/db.js';
import { getSyncState, setSyncState } from './_lib/documents.js';
import { escapeHtml, sendReadingEmail } from './_lib/email.js';
import type { Price } from './_lib/pricing.js';
import {
  checkPrices,
  PRICE_CHECK_STATE,
  type PriceCheckReport,
  type PriceCheckState,
  PRICING_URL,
} from './_lib/prices-check.js';

/**
 * Model Price Check Cron Handler
 *
 * Triggered by Vercel cron daily at 5am UTC (see vercel.json), with
 * `Authorization: Bearer $CRON_SECRET`. Reads Anthropic's pricing page and
 * records new models and price changes in `model_prices`, dated today, so
 * each LLM call is priced at the rate in effect when it was made (see
 * _lib/prices-check.ts). Daily rather than monthly so a change is dated to
 * the day; it's one request, and it only emails when prices change or the
 * check starts failing. Options:
 * - email: Send the email when something changed (default: true)
 */

const PRICE_FIELDS: [keyof Price, string][] = [
  ['input', 'Input'],
  ['cacheWrite5m', '5m cache write'],
  ['cacheWrite1h', '1h cache write'],
  ['cacheRead', 'Cache read'],
  ['output', 'Output'],
  ['webSearch', 'Web search'],
];

const priceCells = (price: Price) =>
  PRICE_FIELDS.map(
    ([key]) => `<td style="padding: 2px 10px">$${price[key]}</td>`,
  ).join('');

function reportEmail(report: PriceCheckReport): {
  subject: string;
  html: string;
} {
  const changedRows = report.changed.flatMap(({ model, before, after }) =>
    PRICE_FIELDS.filter(
      ([key]) => Math.abs(before[key] - after[key]) >= 1e-9,
    ).map(([key, label]) => {
      const percent =
        before[key] === 0
          ? 'n/a'
          : `${after[key] > before[key] ? '+' : ''}${(((after[key] - before[key]) / before[key]) * 100).toFixed(1)}%`;
      return `<tr><td style="padding: 4px 10px">${escapeHtml(model)}<br>${label}</td><td style="padding: 4px 10px"><b>$${before[key]} &rarr; $${after[key]}</b></td><td style="padding: 4px 10px"><b>${percent}</b></td></tr>`;
    }),
  );
  const addedRows = report.added.map(
    ({ model, price }) =>
      `<tr><td style="padding: 2px 10px">${escapeHtml(model)}</td>${priceCells(price)}</tr>`,
  );
  const notes = [
    report.rejected.length > 0 &&
      `Rows left out: ${report.rejected.map(({ row, reason }) => `${row} (${reason})`).join('; ')}.`,
    report.unlisted.length > 0 &&
      `No longer listed (prices kept): ${report.unlisted.join(', ')}.`,
    report.costsFilled > 0 &&
      `Filled in the cost of ${report.costsFilled} earlier calls that had no price.`,
  ].filter(Boolean);

  const summary = `${report.added.length} model${report.added.length === 1 ? '' : 's'} added; ${report.changed.length} existing model${report.changed.length === 1 ? "'s prices" : ' prices'} changed`;
  const subject = `Model price check: ${summary}`;
  const html = `<div style="font-family: sans-serif; font-size: 14px">
<p><b>${summary}.</b></p>
<p>The daily check compared <a href="${PRICING_URL.replace(/\.md$/, '')}">Anthropic's pricing page</a> with our stored prices. USD per million tokens; web search per 1,000 searches.</p>
${
  changedRows.length > 0
    ? `<h2 style="font-size: 16px">Price changes</h2>
<p>Only changed rates are shown; all other rates for these models stayed the same.</p>
<table style="border-collapse: collapse; font-size: 13px">
<tr><th align="left" style="padding: 4px 10px">Model / rate</th><th align="left" style="padding: 4px 10px">Previous &rarr; current</th><th align="left" style="padding: 4px 10px">Change</th></tr>
${changedRows.join('\n')}
</table>
<p>Changed rates take effect today. Earlier calls with a recorded cost keep that cost.</p>`
    : '<p>No existing model prices changed.</p>'
}
${
  addedRows.length > 0
    ? `<h2 style="font-size: 16px">Newly tracked models</h2>
<p>These models had no prices stored in our database, so there is no previous price to compare. This does not necessarily mean they are newly released models.</p>
<table style="border-collapse: collapse; font-size: 13px">
<tr><th align="left" style="padding: 2px 10px">Model</th><th align="left" style="padding: 2px 10px">Input</th><th align="left" style="padding: 2px 10px">5m cache write</th><th align="left" style="padding: 2px 10px">1h cache write</th><th align="left" style="padding: 2px 10px">Cache read</th><th align="left" style="padding: 2px 10px">Output</th><th align="left" style="padding: 2px 10px">Web search</th></tr>
${addedRows.join('\n')}
</table>`
    : ''
}
${notes.length > 0 ? `<p style="color: #666">${escapeHtml(notes.join(' '))}</p>` : ''}
</div>`;
  return { subject, html };
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'GET') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const unauthorized = rejectUnauthorizedCron(request);
    if (unauthorized) return unauthorized;

    const sendEmail =
      new URL(request.url).searchParams.get('email') !== 'false';
    const checkedAt = new Date().toISOString();
    let previous: PriceCheckState | undefined;

    try {
      const sql = await requireSql();
      previous = await getSyncState<PriceCheckState>(PRICE_CHECK_STATE);
      const report = await checkPrices(sql);
      await setSyncState(PRICE_CHECK_STATE, {
        checkedAt,
        ok: true,
        rejected: report.rejected,
      } satisfies PriceCheckState);

      let emailed = false;
      if (sendEmail && (report.added.length > 0 || report.changed.length > 0)) {
        await sendReadingEmail({
          fromName: 'Price check',
          ...reportEmail(report),
        });
        emailed = true;
      }

      console.log('Price check report:', JSON.stringify(report));
      return Response.json({ success: true, ...report, emailed });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('Error checking model prices:', error);

      // Email once when the check starts failing; the weekly email repeats it
      const failingSince =
        previous?.ok === false ? previous.failingSince : checkedAt;
      try {
        await setSyncState(PRICE_CHECK_STATE, {
          checkedAt,
          ok: false,
          error: message,
          failingSince,
        } satisfies PriceCheckState);
        if (sendEmail && previous?.ok !== false) {
          await sendReadingEmail({
            fromName: 'Price check',
            subject: 'Model price check failed',
            html: `<p style="font-family: sans-serif">The daily price check couldn't read <a href="${PRICING_URL.replace(/\.md$/, '')}">Anthropic's pricing page</a>, so nothing changed: calls are still priced at the last known rates. Reason: ${escapeHtml(message)}</p><p style="font-family: sans-serif">If the page layout changed, update the parser in <code>api/_lib/prices-check.ts</code>.</p>`,
          });
        }
      } catch (stateError) {
        console.error('Could not record the failed price check:', stateError);
      }

      return Response.json(
        { error: 'Failed to check model prices', details: message },
        { status: 500 },
      );
    }
  },
};
