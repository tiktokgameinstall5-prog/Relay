import { IsOptional, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class ForwardStepDto {
  @ApiPropertyOptional({
    description:
      'Optional UUID of a specific teammate in the same team to hand off the task to. ' +
      'If omitted, standard sequential relay progression is used.',
    example: 'd3b07384-d113-40f4-a09b-439564f9ef31',
  })
  @IsOptional()
  @IsUUID('4')
  targetUserId?: string;
}
