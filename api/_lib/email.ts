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

// Resend only sends from verified domains. Until nimo.fyi is verified, set
// EMAIL_FROM to onboarding@resend.dev (it can only send to your Resend signup address).
const DEFAULT_FROM = 'Weekly Reading <reader@nimo.fyi>';

function getRecipientEmail(): string {
  const email = process.env.EMAIL_TO;
  if (!email) {
    throw new Error('EMAIL_TO environment variable is not set');
  }
  return email;
}

/**
 * Send the weekly reading summary email
 */
export async function sendWeeklySummary(
  html: string,
  subject: string,
): Promise<{ id: string }> {
  const apiKey = getApiKey();
  const recipientEmail = getRecipientEmail();

  const payload: SendEmailPayload = {
    from: process.env.EMAIL_FROM || DEFAULT_FROM,
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
