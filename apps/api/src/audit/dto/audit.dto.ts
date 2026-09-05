import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

export class AuditLogQueryDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ description: 'Filter by action name (e.g. member.created)' })
  @IsOptional()
  @IsString()
  action?: string;

  @ApiPropertyOptional({ description: 'Filter by actor user ID' })
  @IsOptional()
  @IsUUID()
  actorId?: string;

  @ApiPropertyOptional({ description: 'Filter by start date (ISO string)' })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'Filter by end date (ISO string)' })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class AuditLogItemDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiPropertyOptional({ nullable: true })
  userName?: string | null;

  @ApiProperty()
  action!: string;

  @ApiPropertyOptional({ nullable: true })
  entityType?: string | null;

  @ApiPropertyOptional({ format: 'uuid', nullable: true })
  entityId?: string | null;

  @ApiPropertyOptional({ nullable: true })
  metadata?: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  ipAddress?: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;
}

export class AuditLogListResponseDto {
  @ApiProperty({ type: [AuditLogItemDto] })
  items!: AuditLogItemDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
