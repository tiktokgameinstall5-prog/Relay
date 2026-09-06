/**
 * Passcode reset / recovery email template.
 */
import { renderBaseLayout, renderEmailButton, renderPasscodeBox } from './layout';

export interface PasscodeResetEmailData {
  recipientName: string;
  passcode: string;
  resetLink: string;
  ttlHours: number;
}

export function renderPasscodeResetEmail(data: PasscodeResetEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const subject = 'Your Relay Passcode Reset';

  const text =
    `Hello ${data.recipientName},\n\n` +
    `A passcode reset was requested for your Relay account.\n` +
    `Your passcode: ${data.passcode}\n\n` +
    `This passcode expires in ${data.ttlHours} hours.\n` +
    `Use it to sign in at: ${data.resetLink}\n\n` +
    `If you did not request this, you can safely ignore this email. Your password remains unchanged.\n\n` +
    `— The Relay team`;

  const bodyContent = `
    <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #161A22; line-height: 1.3;">
      Reset Your Relay Passcode
    </h1>
    <p style="margin: 0 0 16px 0; font-size: 15px; color: #374151; line-height: 1.6;">
      Hello <strong>${data.recipientName}</strong>,
    </p>
    <p style="margin: 0 0 20px 0; font-size: 15px; color: #374151; line-height: 1.6;">
      A passcode reset was requested for your Relay account. Use your new single-use passcode below to set a new password and log in.
    </p>

    ${renderPasscodeBox(data.passcode, data.ttlHours)}

    <div style="text-align: center;">
      ${renderEmailButton('Reset Password & Sign In', data.resetLink)}
    </div>

    <div style="margin-top: 24px; padding-top: 20px; border-top: 1px solid #E4E7EC; font-size: 13px; color: #6B7280; line-height: 1.5;">
      <p style="margin: 0 0 8px;"><strong>Security notice:</strong></p>
      <p style="margin: 0 0 12px 0;">If you did not request this password reset, you can safely ignore this email. Your current password remains secure and active.</p>
      <p style="margin: 0; font-size: 12px; color: #9CA3AF;">
        Direct link:<br>
        <a href="${data.resetLink}" style="color: #3654F4; word-break: break-all;">${data.resetLink}</a>
      </p>
    </div>
  `;

  const html = renderBaseLayout({
    title: subject,
    preheader: 'Your temporary Relay single-use passcode is inside. Use it to reset your password.',
    bodyContent,
  });

  return { subject, text, html };
}
