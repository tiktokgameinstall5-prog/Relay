import { Module } from '@nestjs/common';
import { DbModule } from '../db/db.module';
import { NotificationModule } from '../notifications/notification.module';
import { RankingController } from './ranking.controller';
import { RankingService } from './ranking.service';

@Module({
  imports: [DbModule, NotificationModule],
  controllers: [RankingController],
  providers: [RankingService],
  exports: [RankingService],
})
export class RankingModule {}
