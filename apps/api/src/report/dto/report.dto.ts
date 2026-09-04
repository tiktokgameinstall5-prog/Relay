import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateTaskReportDto {
  @ApiProperty({ description: 'Summary of the completed task and deliverables', example: 'Brand assets finalized and reviewed.' })
  @IsString()
  @IsNotEmpty()
  summary!: string;

  @ApiPropertyOptional({ description: 'Key successes, milestones, or achievements', example: '100% on-time delivery.' })
  @IsOptional()
  @IsString()
  highlights?: string;

  @ApiPropertyOptional({ description: 'Any blockers, delays, or obstacles encountered', example: 'None.' })
  @IsOptional()
  @IsString()
  blockers?: string;

  @ApiPropertyOptional({ description: 'Custom structured metadata / metrics', type: 'object', additionalProperties: true })
  @IsOptional()
  metadata?: Record<string, unknown>;
}

export class TaskReportResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiPropertyOptional()
  taskName?: string;

  @ApiProperty({ format: 'uuid' })
  reportedByUserId!: string;

  @ApiPropertyOptional()
  reportedByName?: string;

  @ApiProperty()
  summary!: string;

  @ApiPropertyOptional()
  highlights?: string;

  @ApiPropertyOptional()
  blockers?: string;

  @ApiPropertyOptional({ type: 'object', additionalProperties: true })
  metadata?: Record<string, unknown>;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;
}
