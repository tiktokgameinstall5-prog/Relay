import { Module } from '@nestjs/common';
import { NotificationModule } from '../notifications/notification.module';
import { SchedulerService } from './scheduler.service';

@Module({
  imports: [NotificationModule],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
