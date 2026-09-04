import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsNotEmpty, IsString, Max, Min, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

export class UpdateRankingDto {
  @ApiProperty({ description: 'New member ranking between 0 and 100', minimum: 0, maximum: 100, example: 85 })
  @IsInt()
  @Min(0)
  @Max(100)
  ranking!: number;

  @ApiProperty({ description: 'Audit reason for why ranking was modified', example: 'Exceptional sprint contribution' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  reason!: string;
}

export class SetReporterDto {
  @ApiProperty({ description: 'Whether the member is a designated task completion reporter', example: true })
  @IsBoolean()
  isReporter!: boolean;
}

export class LeaderboardUserDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty({ enum: ['member', 'manager', 'owner'] })
  role!: string;

  @ApiProperty({ example: 85 })
  ranking!: number;

  @ApiProperty({ example: false })
  isReporter!: boolean;

  @ApiPropertyOptional({ format: 'uuid' })
  teamId!: string | null;

  @ApiPropertyOptional()
  teamName!: string | null;
}

export class RankingEventResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  userId!: string;

  @ApiProperty({ example: 50 })
  oldRanking!: number;

  @ApiProperty({ example: 85 })
  newRanking!: number;

  @ApiProperty({ format: 'uuid' })
  changedByUserId!: string;

  @ApiPropertyOptional()
  changedByName?: string;

  @ApiProperty({ example: 'Exceptional sprint contribution' })
  reason!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}
