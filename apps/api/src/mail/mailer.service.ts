/**
 * Outbound email.
 *
 * One method, one message shape. Callers do not know or care which driver is
 * configured. Supports:
 *   - 'console': renders the message to logger (development and automated testing)
 *   - 'smtp': dispatches real email via nodemailer (production transactional email)
 *
 * WHY MAIL FAILURE MUST NOT BE FATAL TO ITS CALLER
 *
 * Provisioning commits its transaction before sending. If delivery then fails,
 * the account still exists and the passcode is regenerable by the issuer
 * (CLAUDE.md §1) — rolling back a created Manager because an SMTP host was
 * briefly unreachable would be the worse outcome. Callers are expected to
 * catch, report `inviteEmailSent: false`, and carry on.
 */
import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import { appEnv } from '../config/configuration';
import type { MailDriver } from '../config/env.validation';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text content. */
  text: string;
  /** Optional HTML content for rich email clients. */
  html?: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly driver: MailDriver;
  private readonly from: string;
  private readonly isDevelopment: boolean;
  private readonly transporter?: Transporter;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const env = appEnv(config);
    this.driver = env.MAIL_DRIVER;
    this.from = env.MAIL_FROM;
    this.isDevelopment = env.NODE_ENV !== 'production';

    if (this.driver === 'smtp') {
      const port = env.SMTP_PORT ?? 587;
      const secure = env.SMTP_SECURE ?? (port === 465);
      this.transporter = nodemailer.createTransport({
        host: env.SMTP_HOST,
        port,
        secure,
        auth: {
          user: env.SMTP_USER,
          pass: env.SMTP_PASS,
        },
      });
      this.logger.log(
        `SMTP driver initialized for ${env.SMTP_HOST}:${port} (secure: ${secure}) with from "${this.from}"`,
      );
    }
  }

  getDriver(): MailDriver {
    return this.driver;
  }

  async send(msg: MailMessage): Promise<void> {
    switch (this.driver) {
      case 'console':
        this.sendToConsole(msg);
        return;
      case 'smtp':
        await this.sendSmtp(msg);
        return;
    }
  }

  /**
   * Verify SMTP connection and credentials with the upstream mail server.
   */
  async verifyConnection(): Promise<boolean> {
    if (this.driver !== 'smtp' || !this.transporter) {
      return false;
    }
    try {
      await this.transporter.verify();
      this.logger.log('SMTP connection verified successfully.');
      return true;
    } catch (err) {
      this.logger.error(`SMTP verification failed: ${(err as Error).message}`);
      throw err;
    }
  }

  /**
   * Dispatches email via the configured SMTP transporter.
   */
  private async sendSmtp(msg: MailMessage): Promise<void> {
    if (!this.transporter) {
      throw new Error('SMTP transporter is not initialized.');
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: msg.to,
        subject: msg.subject,
        text: msg.text,
        ...(msg.html ? { html: msg.html } : {}),
      });
      this.logger.log(
        `Email dispatched via SMTP to "${msg.to}" (messageId: ${info.messageId})`,
      );
    } catch (err) {
      this.logger.error(
        `SMTP send failure to "${msg.to}": ${(err as Error).message}`,
      );
      if (this.isDevelopment) {
        this.logger.warn(
          `[Development Fallback] SMTP delivery failed. Logging invite message to console:`,
        );
        this.sendToConsole(msg);
      }
      throw err;
    }
  }

  /**
   * Renders the whole message to the log, passcode included. That is the point
   * in development — there is no inbox to check — and the reason production
   * should use the SMTP driver.
   */
  private sendToConsole(msg: MailMessage): void {
    this.logger.log(
      `\n` +
        `--- MAIL (console driver) ---------------------------------------\n` +
        `From:    ${this.from || '(unset)'}\n` +
        `To:      ${msg.to}\n` +
        `Subject: ${msg.subject}\n` +
        `\n${msg.text}\n` +
        `-----------------------------------------------------------------`,
    );
  }
}
