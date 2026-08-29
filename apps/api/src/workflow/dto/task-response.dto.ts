import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TaskStatus, TaskStepStatus, TaskType } from '../../db/schema';

export class TaskAssigneeDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Hassan Raza' })
  name!: string;

  @ApiProperty({ example: 'hassan@company.com' })
  email!: string;

  @ApiPropertyOptional({ example: 'Designer' })
  roleTitle?: string | null;
}

export class TaskStepResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  taskId!: string;

  @ApiProperty({ format: 'uuid' })
  assignedUserId!: string;

  @ApiProperty({ example: 'Hassan Raza' })
  assignedUserName!: string;

  @ApiProperty({ example: 1 })
  stepOrder!: number;

  @ApiProperty({ enum: ['pending', 'active', 'completed'], example: 'active' })
  status!: TaskStepStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  startedAt?: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  completedAt?: string | null;

  @ApiPropertyOptional({ example: 1200, description: 'Duration in seconds (completedAt - startedAt or now - startedAt if active)' })
  durationSeconds?: number | null;
}

export class TaskResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  orgId!: string;

  @ApiProperty({ format: 'uuid' })
  managerId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  teamId?: string | null;

  @ApiProperty({ example: 'Q3 Product Launch Video' })
  name!: string;

  @ApiProperty({ enum: ['text', 'video', 'file'], example: 'video' })
  type!: TaskType;

  @ApiPropertyOptional({ example: 'Produce, edit, and QA the product launch video.' })
  description?: string | null;

  @ApiProperty({ format: 'uuid' })
  createdByUserId!: string;

  @ApiProperty({ example: 'Ayesha Khan' })
  createdByName!: string;

  @ApiProperty({ enum: ['scheduled', 'in_progress', 'completed'], example: 'in_progress' })
  status!: TaskStatus;

  @ApiPropertyOptional({ type: String, format: 'date-time' })
  scheduledFor?: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  updatedAt!: string;

  @ApiPropertyOptional({ example: 1, description: 'Current active step order, or null if finished/scheduled' })
  currentStepOrder?: number | null;

  @ApiProperty({ example: 4 })
  totalSteps!: number;

  @ApiProperty({ example: 1 })
  completedSteps!: number;

  @ApiPropertyOptional({ type: TaskAssigneeDto, description: 'Member who currently holds the task' })
  currentAssignee?: TaskAssigneeDto | null;

  @ApiProperty({ type: [TaskStepResponseDto] })
  steps!: TaskStepResponseDto[];
}
