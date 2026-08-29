import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { WorkflowService } from './workflow.service';
import { TaskController } from './task.controller';

@Module({
  imports: [DbModule],
  controllers: [TaskController],
  providers: [WorkflowService],
  exports: [WorkflowService],
})
export class WorkflowModule {}
