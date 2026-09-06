/**
 * Base responsive HTML email template for Relay.
 *
 * Implements Relay's design system:
 * - Brand Color: Signal Indigo (#3654F4)
 * - Dark Workspace accents (#181A24)
 * - Cool slate background (#F4F5F8)
 * - Clean card container (#FFFFFF, 1px border #E4E7EC, 12px border-radius)
 * - Cross-client bulletproof table layout compatible with Gmail, Apple Mail, Outlook, mobile webmail.
 */

export interface BaseLayoutOptions {
  title: string;
  preheader?: string;
  bodyContent: string;
}

export function renderEmailButton(label: string, url: string): string {
  return `
    <table border="0" cellspacing="0" cellpadding="0" style="margin: 28px 0 20px 0;">
      <tr>
        <td align="center" style="border-radius: 8px; background-color: #3654F4;">
          <a href="${url}" target="_blank" style="font-size: 15px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 8px; display: inline-block; font-weight: 600; letter-spacing: 0.2px; text-align: center;">
            ${label} &rarr;
          </a>
        </td>
      </tr>
    </table>
  `;
}

export function renderPasscodeBox(passcode: string, ttlHours: number): string {
  return `
    <div style="background-color: #F4F5F8; border: 1px solid #E4E7EC; border-radius: 8px; padding: 20px; text-align: center; margin: 24px 0;">
      <div style="font-size: 11px; font-weight: 700; text-transform: uppercase; color: #6B7280; letter-spacing: 1.2px; margin-bottom: 8px;">
        Single-Use Passcode
      </div>
      <div style="font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 30px; font-weight: 700; color: #161A22; letter-spacing: 5px; padding: 6px 0;">
        ${passcode}
      </div>
      <div style="font-size: 12px; color: #6B7280; margin-top: 8px;">
        Expires in <strong>${ttlHours} hours</strong> &bull; Works once
      </div>
    </div>
  `;
}

export function renderBaseLayout(options: BaseLayoutOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${options.title}</title>
  <style type="text/css">
    body {
      margin: 0;
      padding: 0;
      min-width: 100%;
      background-color: #F4F5F8;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #161A22;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    a {
      color: #3654F4;
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #F4F5F8;">
  ${
    options.preheader
      ? `<div style="display: none; max-height: 0px; overflow: hidden; mso-hide: all;">${options.preheader}&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;</div>`
      : ''
  }
  <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color: #F4F5F8; padding: 32px 16px;">
    <tr>
      <td align="center">
        <!-- Logo / Brand Header -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 580px; margin-bottom: 24px;">
          <tr>
            <td align="left">
              <div style="display: inline-block; font-size: 22px; font-weight: 800; color: #181A24; letter-spacing: -0.5px; text-decoration: none;">
                Relay<span style="color: #3654F4;">.</span>
              </div>
            </td>
          </tr>
        </table>

        <!-- Main Card -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 580px; background-color: #FFFFFF; border: 1px solid #E4E7EC; border-radius: 12px; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05); overflow: hidden;">
          <tr>
            <td style="padding: 36px 32px 32px 32px; font-size: 15px; line-height: 1.6; color: #161A22;">
              ${options.bodyContent}
            </td>
          </tr>
        </table>

        <!-- Footer -->
        <table width="100%" border="0" cellpadding="0" cellspacing="0" style="max-width: 580px; margin-top: 24px;">
          <tr>
            <td align="center" style="font-size: 12px; line-height: 1.6; color: #9CA3AF; text-align: center;">
              <p style="margin: 0 0 6px;">Sent by <strong>Relay</strong> &mdash; Sequential Task Handoff & Team Platform</p>
              <p style="margin: 0;">Keep this email private. Passcodes and invitation links provide direct access to your account.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
