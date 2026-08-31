import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { StorageModule } from '../storage/storage.module';
import { WorkflowService } from './workflow.service';
import { TaskController } from './task.controller';
import { AttachmentService } from './attachment.service';
import { AttachmentController } from './attachment.controller';

import { NotificationModule } from '../notifications/notification.module';

@Module({
  imports: [DbModule, StorageModule, NotificationModule],
  controllers: [TaskController, AttachmentController],
  providers: [WorkflowService, AttachmentService],
  exports: [WorkflowService, AttachmentService],
})
export class WorkflowModule {}

