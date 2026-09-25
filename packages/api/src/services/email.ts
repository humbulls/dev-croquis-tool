import type { Env } from '../env';

export interface Email {
  to: string;
  subject: string;
  text: string;
}

/** True when the instance can send mail (Resend). Otherwise links are copied by hand. */
export function emailEnabled(env: Env): boolean {
  return Boolean(env.RESEND_API_KEY && env.EMAIL_FROM);
}

/**
 * Send a plain-text transactional email through Resend. Never throws: a mail
 * outage must not fail the request that triggered it (the caller reports
 * `email_sent: false` and the dashboard offers the link instead).
 */
export async function sendEmail(env: Env, email: Email): Promise<boolean> {
  if (!emailEnabled(env)) return false;
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
