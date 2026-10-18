import { config } from './env.js';

/** Sends the sign-in code. Without RESEND_API_KEY (sandbox) it's logged instead. */
export async function sendLoginCode(email: string, code: string): Promise<void> {
  if (!config.resendKey) {
    console.log(`[quo] sign-in code for ${email}: ${code}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [email],
      subject: `${code} is your Quo sign-in code`,
      text: `Your Quo sign-in code is ${code}\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`,
    }),
  });
  if (!response.ok) throw new Error(`email_failed_${response.status}`);
}
