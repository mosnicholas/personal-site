/**
 * Email sending via Resend
 * Documentation: https://resend.com/docs
 */

const RESEND_API_BASE = 'https://api.resend.com';

interface SendEmailPayload {
  from: string;
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
}

interface SendEmailResponse {
  id: string;
}

function getApiKey(): string {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error('RESEND_API_KEY environment variable is not set');
  }
  return apiKey;
}

// nimo.fyi is verified in Resend
const FROM_ADDRESS = 'reader@nimo.fyi';

function getRecipientEmail(): string {
  const email = process.env.WEEKLY_SUMMARY_RECIPIENT_EMAIL;
  if (!email) {
    throw new Error(
      'WEEKLY_SUMMARY_RECIPIENT_EMAIL environment variable is not set',
    );
  }
  return email;
}

export const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!,
  );

/**
 * Send a reading email (weekly summary, synthesis) to the reader, with an
 * optional small-print `footer`
 */
export async function sendReadingEmail({
  fromName,
  subject,
  html,
  footer,
}: {
  fromName: string;
  subject: string;
  html: string;
  footer?: string;
}): Promise<{ id: string }> {
  const apiKey = getApiKey();
  const recipientEmail = getRecipientEmail();

  if (footer) {
    const footerHtml = `<p style="color: #999; font-size: 12px; margin-top: 40px;">${escapeHtml(footer)}</p>`;
    html = html.includes('</body>')
      ? html.replace('</body>', `${footerHtml}\n</body>`)
      : `${html}\n${footerHtml}`;
  }

  const payload: SendEmailPayload = {
    from: `${fromName} <${FROM_ADDRESS}>`,
    to: recipientEmail,
    subject,
    html,
  };

  const response = await fetch(`${RESEND_API_BASE}/emails`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Resend API error (${response.status}): ${errorText}`);
  }

  return response.json() as Promise<SendEmailResponse>;
}
