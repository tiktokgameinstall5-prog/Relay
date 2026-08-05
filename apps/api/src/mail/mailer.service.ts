/**
 * Outbound email.
 *
 * One method, one message shape. Callers do not know or care which driver is
 * configured, so adding SMTP later (task #8) changes this file and nothing else.
 *
 * WHY ONLY A CONSOLE DRIVER TODAY
 *
 * nodemailer is already a dependency and .env.example already advertises
 * MAIL_DRIVER=smtp, but SMTP cannot be exercised here: .claude/settings.json
 * denies outbound network calls, so an SMTP transport would ship as untested,
 * unexercised code on the invite path. env.validation.ts refuses to boot with
 * MAIL_DRIVER=smtp for exactly that reason — an explicit "not implemented yet"
 * rather than a silent no-op the first time an Owner invites a Manager.
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
import { appEnv } from '../config/configuration';
import type { MailDriver } from '../config/env.validation';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text. No HTML driver yet — invite mail has no need for one. */
  text: string;
}

@Injectable()
export class MailerService {
  private readonly logger = new Logger(MailerService.name);
  private readonly driver: MailDriver;
  private readonly from: string;

  constructor(@Inject(ConfigService) config: ConfigService) {
    const env = appEnv(config);
    this.driver = env.MAIL_DRIVER;
    this.from = env.MAIL_FROM;
  }

  async send(msg: MailMessage): Promise<void> {
    switch (this.driver) {
      case 'console':
        this.sendToConsole(msg);
        return;
      case 'smtp':
        // Unreachable: env.validation.ts refuses to boot with this driver.
        // Kept so the switch is exhaustive and the gap is visible here too.
        throw new Error('MAIL_DRIVER=smtp is not implemented yet.');
    }
  }

  /**
   * Renders the whole message to the log, passcode included. That is the point
   * in development — there is no inbox to check — and the reason production
   * cannot boot with this driver.
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
