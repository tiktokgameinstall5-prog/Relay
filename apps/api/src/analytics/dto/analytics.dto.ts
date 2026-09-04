import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class TaskStatsDto {
  @ApiProperty({ example: 42 })
  total!: number;

  @ApiProperty({ example: 35 })
  completed!: number;

  @ApiProperty({ example: 5 })
  inProgress!: number;

  @ApiProperty({ example: 2 })
  scheduled!: number;

  @ApiProperty({ example: 83.3 })
  completionRate!: number;
}

export class TopPerformerDto {
  @ApiProperty({ example: 'Alice Member' })
  name!: string;

  @ApiProperty({ example: 98 })
  score!: number;
}

export class RankingStatsDto {
  @ApiProperty({ example: 78.5 })
  averageRanking!: number;

  @ApiPropertyOptional({ type: TopPerformerDto, nullable: true })
  topPerformer!: TopPerformerDto | null;
}

export class AnalyticsOverviewDto {
  @ApiProperty({ type: TaskStatsDto })
  tasks!: TaskStatsDto;

  @ApiProperty({ type: RankingStatsDto })
  rankings!: RankingStatsDto;

  @ApiProperty({ example: 12 })
  membersCount!: number;

  // Flat fields for compatibility
  totalTasks?: number;
  completedTasks?: number;
  inProgressTasks?: number;
  scheduledTasks?: number;
  completionRate?: number;
  averageRanking?: number;
  topPerformerName?: string;
  topPerformerScore?: number;
}

export class BottleneckStepDto {
  @ApiProperty()
  stepId!: string;

  @ApiProperty()
  taskId!: string;

  @ApiProperty()
  taskName!: string;

  @ApiProperty()
  stepOrder!: number;

  @ApiProperty()
  memberName!: string;

  @ApiProperty()
  durationSeconds!: number;

  @ApiProperty()
  durationFormatted!: string;
}

export class BottlenecksResponseDto {
  @ApiProperty({ type: [BottleneckStepDto] })
  bottlenecks!: BottleneckStepDto[];

  @ApiProperty()
  averageStepDurationSeconds!: number;
}
