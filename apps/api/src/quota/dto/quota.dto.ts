import { ApiProperty } from '@nestjs/swagger';

export class QuotaResourceDto {
  @ApiProperty({ example: 3 })
  current!: number;

  @ApiProperty({ example: 20 })
  limit!: number;
}

export class QuotaUsageDto {
  @ApiProperty({ type: QuotaResourceDto })
  teams!: QuotaResourceDto;

  @ApiProperty({ type: QuotaResourceDto })
  members!: QuotaResourceDto;

  @ApiProperty({ type: QuotaResourceDto })
  activeTasks!: QuotaResourceDto;
}
