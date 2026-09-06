/**
 * Task and workflow notification email template.
 */
import { renderBaseLayout, renderEmailButton } from './layout';

export interface TaskNotificationEmailData {
  recipientName?: string;
  title: string;
  body: string;
  actionUrl: string;
  actionLabel?: string;
  statusBadge?: string;
  subject?: string;
}

export function renderTaskNotificationEmail(data: TaskNotificationEmailData): {
  subject: string;
  text: string;
  html: string;
} {
  const subject =
    data.subject ||
    (data.title.toLowerCase().startsWith('relay') ? data.title : `Relay: ${data.title}`);

  const text =
    `${data.recipientName ? `Hi ${data.recipientName},\n\n` : ''}` +
    `${data.title}\n\n` +
    `${data.body}\n\n` +
    `View in Relay:\n${data.actionUrl}\n\n` +
    `— The Relay team`;

  const badgeHtml = data.statusBadge
    ? `<span style="display: inline-block; background-color: #3654F4; color: #FFFFFF; font-size: 11px; font-weight: 700; padding: 3px 8px; border-radius: 9999px; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px;">${data.statusBadge}</span>`
    : '';

  const bodyContent = `
    ${badgeHtml}
    <h1 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #161A22; line-height: 1.3;">
      ${data.title}
    </h1>
    ${
      data.recipientName
        ? `<p style="margin: 0 0 16px 0; font-size: 15px; color: #374151; line-height: 1.6;">Hi <strong>${data.recipientName}</strong>,</p>`
        : ''
    }
    <div style="background-color: #F4F5F8; border-left: 4px solid #3654F4; padding: 16px 20px; border-radius: 4px; margin: 20px 0; font-size: 15px; color: #1F2937; line-height: 1.6;">
      ${data.body.replace(/\n/g, '<br>')}
    </div>

    <div style="text-align: center; margin: 28px 0 16px 0;">
      ${renderEmailButton(data.actionLabel || 'View in Relay Workspace', data.actionUrl)}
    </div>

    <p style="margin: 24px 0 0 0; font-size: 12px; color: #9CA3AF; text-align: center;">
      Direct link: <a href="${data.actionUrl}" style="color: #3654F4; word-break: break-all;">${data.actionUrl}</a>
    </p>
  `;

  const html = renderBaseLayout({
    title: subject,
    preheader: `${data.title} — ${data.body.slice(0, 100)}`,
    bodyContent,
  });

  return { subject, text, html };
}
