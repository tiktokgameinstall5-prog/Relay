/**
 * CLI script to verify SMTP transport and send a real test email.
 *
 * Usage:
 *   npx tsx --env-file-if-exists=.env src/mail/scripts/test-mail.ts [recipient-email]
 *
 * Example:
 *   npm --workspace apps/api run mail:test your-email@example.com
 */
import nodemailer from 'nodemailer';
import { validateEnv } from '../../config/env.validation';
import { renderInviteEmail } from '../templates/invite';

async function main() {
  console.log('--- Outbound Mail Diagnostic & Test ---');

  let env;
  try {
    env = validateEnv();
  } catch (err) {
    console.error('\n❌ Environment validation failed:');
    console.error((err as Error).message);
    process.exit(1);
  }

  console.log(`Driver:       ${env.MAIL_DRIVER}`);
  console.log(`From Address: ${env.MAIL_FROM || '(unset)'}`);

  const recipient = (process.argv[2] || '').trim();
  if (!recipient) {
    console.log('\nUsage: npm run mail:test <recipient-email>');
    console.log('Provide a destination email address to send a real verification message.');
    if (env.MAIL_DRIVER === 'smtp') {
      console.log(`\nVerifying SMTP handshake with ${env.SMTP_HOST}:${env.SMTP_PORT ?? 587}...`);
      const transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE ?? (env.SMTP_PORT === 465),
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
      await transporter.verify();
      console.log('✅ SMTP connection & authentication successful!');
    }
    return;
  }

  const inviteLink = `${env.APP_BASE_URL || 'http://localhost:5173'}/invite?email=${encodeURIComponent(recipient)}`;
  const sampleEmail = renderInviteEmail({
    recipientName: recipient.split('@')[0],
    organizationName: 'Acme Operations',
    passcode: 'DEMO-7842',
    inviteLink,
    ttlHours: 72,
  });

  if (env.MAIL_DRIVER === 'console') {
    console.log(`\n⚠️  MAIL_DRIVER is set to "console". Emails are logged to terminal only.`);
    console.log(`To send real emails, set MAIL_DRIVER=smtp in apps/api/.env with your provider credentials.`);
    console.log(`\nSample Message Output:`);
    console.log(`From:    ${env.MAIL_FROM}`);
    console.log(`To:      ${recipient}`);
    console.log(`Subject: ${sampleEmail.subject}`);
    console.log(`Text:\n${sampleEmail.text}\n`);
    return;
  }

  console.log(`\nConnecting to SMTP host: ${env.SMTP_HOST}:${env.SMTP_PORT ?? 587} (secure: ${env.SMTP_SECURE ?? false})...`);
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE ?? (env.SMTP_PORT === 465),
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });

  try {
    console.log('Verifying SMTP credentials...');
    await transporter.verify();
    console.log('✅ SMTP connection & credentials verified.');
  } catch (err) {
    console.error(`\n❌ SMTP connection/authentication failed: ${(err as Error).message}`);
    process.exit(1);
  }

  console.log(`Sending branded invitation & activation email to ${recipient}...`);
  try {
    const info = await transporter.sendMail({
      from: env.MAIL_FROM,
      to: recipient,
      subject: sampleEmail.subject,
      text: sampleEmail.text,
      html: sampleEmail.html,
    });

    console.log(`\n🎉 Email sent successfully!`);
    console.log(`Message ID: ${info.messageId}`);
    console.log(`Response:   ${info.response}`);
  } catch (err) {
    console.error(`\n❌ Failed to send email: ${(err as Error).message}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
