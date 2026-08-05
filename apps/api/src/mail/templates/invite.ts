/**
 * Manager/Member invite email template.
 *
 * Plain text only — the message is a passcode, a link, and instructions; no need
 * for HTML layout. Structure this so adding an HTML variant later (if the design
 * ever calls for one) would just add a second method, not change callers.
 */

export interface InviteEmailData {
  recipientName: string;
  organizationName: string;
  /** Plaintext passcode, as printed on the console driver. */
  passcode: string;
  /** Absolute invite URL with the email prefilled: APP_BASE_URL/invite?email=... */
  inviteLink: string;
  /** How many hours until the passcode expires. */
  ttlHours: number;
}

/**
 * Render the invite email body.
 *
 * The passcode appears as text in the body; the link prefills the email but
 * deliberately does NOT carry the passcode in the URL — URLs leak via Referer,
 * browser history, proxy/CDN logs, and shared screenshots, and this is a login
 * credential rather than a nonce.
 */
export function renderInviteEmail(data: InviteEmailData): { subject: string; text: string } {
  const subject = `You've been invited to ${data.organizationName} on Relay`;

  const text =
    `Hi ${data.recipientName},\n\n` +
    `You've been added to ${data.organizationName} on Relay.\n\n` +
    `Your passcode: ${data.passcode}\n` +
    `(expires in ${data.ttlHours} hours)\n\n` +
    `Sign in here:\n${data.inviteLink}\n\n` +
    `You'll choose a permanent password when you sign in. The passcode works\n` +
    `once, so keep this email until you've used it.\n\n` +
    `— The Relay team`;

  return { subject, text };
}
