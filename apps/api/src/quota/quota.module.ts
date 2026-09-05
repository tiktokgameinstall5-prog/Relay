import { Module } from '@nestjs/common';
import { QuotaController } from './quota.controller';
import { QuotaService } from './quota.service';
import { DbModule } from '../db/db.module';

@Module({
  imports: [DbModule],
  controllers: [QuotaController],
  providers: [QuotaService],
  exports: [QuotaService],
})
export class QuotaModule {}
