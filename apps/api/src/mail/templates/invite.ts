/**
 * Manager/Member invite email template.
 *
 * Provides both rich HTML with Relay branding and bulletproof plain-text fallback.
 */
import { renderBaseLayout, renderEmailButton, renderPasscodeBox } from './layout';

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
 * Render the invite email body with rich HTML and plain-text fallback.
 *
 * The passcode appears in the body; the link prefills the email but
 * deliberately does NOT carry the passcode in the URL — URLs leak via Referer,
 * browser history, proxy/CDN logs, and shared screenshots.
 */
export function renderInviteEmail(data: InviteEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = `You've been invited to ${data.organizationName} on Relay`;

  const text =
    `Hi ${data.recipientName},\n\n` +
    `You've been invited to join ${data.organizationName} on Relay.\n\n` +
    `Your passcode: ${data.passcode}\n` +
    `(expires in ${data.ttlHours} hours)\n\n` +
    `Activate your account and set your password here:\n${data.inviteLink}\n\n` +
    `You will choose a permanent password when you activate. The passcode works\n` +
    `once, so keep this email until you've used it.\n\n` +
    `— The Relay team`;

  const bodyContent = `
    <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #161A22; line-height: 1.3;">
      Join ${data.organizationName} on Relay
    </h1>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #374151; line-height: 1.6;">
      Hi <strong>${data.recipientName}</strong>,
    </p>
    <p style="margin: 0 0 20px 0; font-size: 15px; color: #374151; line-height: 1.6;">
      You've been invited to join <strong>${data.organizationName}</strong>'s workspace on Relay. 
      Use your temporary single-use passcode below to activate your account and choose your permanent password.
    </p>

    ${renderPasscodeBox(data.passcode, data.ttlHours)}

    <div style="text-align: center;">
      ${renderEmailButton('Activate Account & Set Password', data.inviteLink)}
    </div>

    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #E4E7EC; font-size: 13px; color: #6B7280; line-height: 1.5;">
      <p style="margin: 0 0 8px;"><strong>How to activate:</strong></p>
      <ol style="margin: 0 0 16px 0; padding-left: 20px;">
        <li style="margin-bottom: 4px;">Click the <strong>Activate Account</strong> button above.</li>
        <li style="margin-bottom: 4px;">Enter your single-use passcode: <code style="background-color: #F3F4F6; padding: 2px 5px; border-radius: 4px; font-family: monospace; color: #111827;">${data.passcode}</code></li>
        <li>Set your permanent password and you're in!</li>
      </ol>
      <p style="margin: 0; font-size: 12px; color: #9CA3AF;">
        Button not working? Copy and paste this link into your browser:<br>
        <a href="${data.inviteLink}" style="color: #3654F4; word-break: break-all;">${data.inviteLink}</a>
      </p>
    </div>
  `;

  const html = renderBaseLayout({
    title: subject,
    preheader: `You've been invited to ${data.organizationName} on Relay. Your single-use passcode is inside.`,
    bodyContent,
  });

  return { subject, text, html };
}
