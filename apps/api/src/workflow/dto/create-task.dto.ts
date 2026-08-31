import {
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TaskType } from '../../db/schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateTaskDto {
  @ApiProperty({
    minLength: 2,
    maxLength: 200,
    example: 'Q3 Product Launch Video',
    description: 'Human-readable title of the task.',
  })
  @IsString()
  @Transform(trim)
  @Length(2, 200)
  name!: string;

  @ApiProperty({
    enum: ['text', 'video', 'file'],
    example: 'video',
    description: 'Content type of the task.',
  })
  @IsIn(['text', 'video', 'file'])
  type!: TaskType;

  @ApiPropertyOptional({
    maxLength: 4000,
    example: 'Produce, edit, and QA the product launch video per brand guidelines.',
    description: 'Detailed instructions or context for the relay chain.',
  })
  @IsOptional()
  @IsString()
  @Transform(trim)
  @MaxLength(4000)
  description?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Ordered array of member UUIDs in the sequence they will work the relay. ' +
      'Step 1 goes to memberIds[0], step 2 to memberIds[1], etc. All must belong to the active team.',
    example: ['d3b07384-d113-40f4-a09b-439564f9ef31', 'e4c18495-e224-51a5-b10c-540675a0fa42'],
  })
  @IsOptional()
  @IsArray()
  @IsUUID('4', { each: true })
  memberIds?: string[];

  @ApiPropertyOptional({
    description: 'Target team UUID when an Owner assigns a task to a whole team.',
    example: 'a1b2c3d4-e5f6-7a8b-9c0d-1e2f3a4b5c6d',
  })
  @IsOptional()
  @IsUUID('4')
  teamId?: string;

  @ApiPropertyOptional({
    description: 'Target manager UUID when an Owner assigns a task directly to a Manager.',
    example: 'b2c3d4e5-f6a7-8b9c-0d1e-2f3a4b5c6d7e',
  })
  @IsOptional()
  @IsUUID('4')
  targetManagerId?: string;

  @ApiPropertyOptional({
    description: 'Target member UUID when an Owner assigns a task directly to a specific Member.',
    example: 'c3d4e5f6-a7b8-9c0d-1e2f-3a4b5c6d7e8f',
  })
  @IsOptional()
  @IsUUID('4')
  targetMemberId?: string;

  @ApiPropertyOptional({
    description: 'ISO-8601 UTC timestamp when the task should become active (up to 365 days in future).',
    example: '2026-09-01T10:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  scheduledFor?: string;
}
