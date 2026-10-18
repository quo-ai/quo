import { config } from './env.js';

/** Tells someone their synced chats will be deleted, after their plan ended. Logged in the sandbox. */
export async function sendSyncLapseNotice(email: string, deleteOn: Date): Promise<void> {
  const date = deleteOn.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  if (!config.resendKey) {
    console.log(`[quo] sync retention notice for ${email}: deletion on ${date}`);
    return;
  }
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.resendKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: config.emailFrom,
      to: [email],
      subject: 'Your synced Quo chats will be deleted on ' + date,
      text: [
        'Your Quo Sync plan has ended, so the encrypted copy of your chats on Quo’s servers will be deleted on ' + date + '.',
        '',
        'Your chats on your own devices are not affected, and nothing in them changes.',
        '',
        'To keep the cloud copy, get Quo Sync or Quo Pro again before then and it carries on where it stopped. You can also open Quo Sync on any of your devices to download your chats first.',
        '',
        'You’re getting this one email because you used Quo Sync. We can’t read your chats, and we can’t recover them after they’re deleted.',
      ].join('\n'),
    }),
  });
  if (!response.ok) throw new Error(`email_failed_${response.status}`);
}

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
