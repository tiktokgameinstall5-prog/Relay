import { Module } from '@nestjs/common';
import { MailerService } from './mailer.service';

/**
 * Exports MailerService for any module that sends mail. Provisioning (#6, #7)
 * is the first consumer; notifications (Phase 4) will be the next.
 */
@Module({
  providers: [MailerService],
  exports: [MailerService],
})
export class MailModule {}
