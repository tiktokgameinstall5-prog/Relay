import { ConfigService } from '@nestjs/config';
import { MailerService, type MailMessage } from './mailer.service';
import { validateEnv } from '../config/env.validation';

describe('MailerService & SMTP Environment Validation', () => {
  const baseValidEnv: Record<string, string> = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://relay_app:secret@localhost:5432/relay',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    APP_BASE_URL: 'http://localhost:5173',
  };

  describe('validateEnv (SMTP rules)', () => {
    it('accepts valid console mail driver', () => {
      const env = validateEnv({
        ...baseValidEnv,
        MAIL_DRIVER: 'console',
      });
      expect(env.MAIL_DRIVER).toBe('console');
    });

    it('rejects unknown mail driver', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'invalid_driver',
        }),
      ).toThrow(/MAIL_DRIVER must be "console" or "smtp"/);
    });

    it('rejects MAIL_DRIVER=smtp if MAIL_FROM or SMTP_HOST are missing', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
        }),
      ).toThrow(/MAIL_FROM is required/);
    });

    it('rejects documentation placeholders in SMTP_PASS and SMTP_USER', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'smtp.custommail.com',
          SMTP_USER: 'your_username_here',
          SMTP_PASS: 'your_api_key_here',
        }),
      ).toThrow(/contains a documentation placeholder/);
    });

    it('enforces Resend specific rules on *resend.com host', () => {
      // Must reject invalid username
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'smtp.resend.com',
          SMTP_USER: 'wrong_user',
          SMTP_PASS: 're_1234567890abcdef1234567890',
        }),
      ).toThrow(/SMTP_USER must be "resend"/);

      // Must reject pass not starting with re_
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'smtp.resend.com',
          SMTP_USER: 'resend',
          SMTP_PASS: 'not_starting_with_re_1234567890',
        }),
      ).toThrow(/SMTP_PASS must start with "re_"/);

      // Must accept valid Resend credentials
      const valid = validateEnv({
        ...baseValidEnv,
        MAIL_DRIVER: 'smtp',
        MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
        SMTP_HOST: 'smtp.resend.com',
        SMTP_USER: 'resend',
        SMTP_PASS: 're_1234567890abcdef1234567890',
      });
      expect(valid.SMTP_HOST).toBe('smtp.resend.com');
      expect(valid.SMTP_USER).toBe('resend');
    });

    it('enforces SendGrid specific rules on *sendgrid.net host', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'smtp.sendgrid.net',
          SMTP_USER: 'admin',
          SMTP_PASS: 'SG.short',
        }),
      ).toThrow(/SMTP_USER must be "apikey"/);

      const valid = validateEnv({
        ...baseValidEnv,
        MAIL_DRIVER: 'smtp',
        MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
        SMTP_HOST: 'smtp.sendgrid.net',
        SMTP_USER: 'apikey',
        SMTP_PASS: 'SG.' + 'a'.repeat(30) + '.' + 'b'.repeat(45),
      });
      expect(valid.SMTP_USER).toBe('apikey');
    });

    it('enforces Postmark specific rules on *postmarkapp.com host', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'smtp.postmarkapp.com',
          SMTP_USER: 'token',
          SMTP_PASS: 'non-uuid-token',
        }),
      ).toThrow(/Postmark Server API Token \(UUID\)/);

      const valid = validateEnv({
        ...baseValidEnv,
        MAIL_DRIVER: 'smtp',
        MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
        SMTP_HOST: 'smtp.postmarkapp.com',
        SMTP_USER: 'b82d3345-9781-4bc9-a5c9-5a1e74a8d052',
        SMTP_PASS: 'b82d3345-9781-4bc9-a5c9-5a1e74a8d052',
      });
      expect(valid.SMTP_HOST).toBe('smtp.postmarkapp.com');
    });

    it('enforces generic weak password check only for custom/generic SMTP', () => {
      expect(() =>
        validateEnv({
          ...baseValidEnv,
          MAIL_DRIVER: 'smtp',
          MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
          SMTP_HOST: 'mail.mycompany.internal',
          SMTP_USER: 'relay-service',
          SMTP_PASS: 'password',
        }),
      ).toThrow(/cannot be a trivial password/);

      // Strong custom credentials pass cleanly
      const valid = validateEnv({
        ...baseValidEnv,
        MAIL_DRIVER: 'smtp',
        MAIL_FROM: 'Relay <notifications@myrelayapp.com>',
        SMTP_HOST: 'mail.mycompany.internal',
        SMTP_USER: 'relay-service',
        SMTP_PASS: 'K9#vP$2mXqL9!wZ7',
      });
      expect(valid.SMTP_PASS).toBe('K9#vP$2mXqL9!wZ7');
    });
  });

  describe('MailerService (Console driver)', () => {
    it('sends via console without throwing', async () => {
      const mockConfig = {
        get: () => ({
          MAIL_DRIVER: 'console',
          MAIL_FROM: 'Relay <no-reply@relay.local>',
        }),
      } as unknown as ConfigService;

      const mailer = new MailerService(mockConfig);
      expect(mailer.getDriver()).toBe('console');

      const msg: MailMessage = {
        to: 'user@example.com',
        subject: 'Test Subject',
        text: 'Test Body',
      };

      await expect(mailer.send(msg)).resolves.toBeUndefined();
    });
  });
});
