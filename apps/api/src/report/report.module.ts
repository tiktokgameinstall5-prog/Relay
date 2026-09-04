import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { ReportController } from './report.controller';
import { ReportService } from './report.service';

@Module({
  imports: [DbModule],
  controllers: [ReportController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportModule {}
