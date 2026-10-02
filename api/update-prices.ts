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

const priceCells = (price: Price) =>
  [
    price.input,
    price.cacheWrite5m,
    price.cacheWrite1h,
    price.cacheRead,
    price.output,
  ]
    .map((value) => `<td style="padding: 2px 10px">$${value}</td>`)
    .join('');

function reportEmail(report: PriceCheckReport): {
  subject: string;
  html: string;
} {
  const rows = [
    ...report.changed.map(
      ({ model, before, after }) =>
        `<tr><td style="padding: 2px 10px">${model} (was)</td>${priceCells(before)}</tr>` +
        `<tr><td style="padding: 2px 10px"><b>${model} (now)</b></td>${priceCells(after)}</tr>`,
    ),
    ...report.added.map(
      ({ model, price }) =>
        `<tr><td style="padding: 2px 10px">${model} (new)</td>${priceCells(price)}</tr>`,
    ),
  ];
  const notes = [
    report.rejected.length > 0 &&
      `Rows left out: ${report.rejected.map(({ row, reason }) => `${row} (${reason})`).join('; ')}.`,
    report.unlisted.length > 0 &&
      `No longer listed (prices kept): ${report.unlisted.join(', ')}.`,
    report.costsFilled > 0 &&
      `Filled in the cost of ${report.costsFilled} earlier calls that had no price.`,
  ].filter(Boolean);

  const subject =
    report.changed.length > 0
      ? `Model prices changed: ${report.changed.map(({ model }) => model).join(', ')}`
      : `Model prices added for ${report.added.length} model${report.added.length === 1 ? '' : 's'}`;
  const html = `<div style="font-family: sans-serif; font-size: 14px">
<p>The daily price check found differences on <a href="${PRICING_URL.replace(/\.md$/, '')}">Anthropic's pricing page</a> and recorded them in <code>model_prices</code>, effective today. Calls from today on are priced at the new rates; earlier calls keep theirs.</p>
<table style="border-collapse: collapse; font-size: 13px">
<tr><th align="left" style="padding: 2px 10px">Model</th><th align="left" style="padding: 2px 10px">Input</th><th align="left" style="padding: 2px 10px">5m cache write</th><th align="left" style="padding: 2px 10px">1h cache write</th><th align="left" style="padding: 2px 10px">Cache read</th><th align="left" style="padding: 2px 10px">Output</th></tr>
${rows.join('\n')}
</table>
<p style="color: #666">USD per million tokens. ${escapeHtml(notes.join(' '))}</p>
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
