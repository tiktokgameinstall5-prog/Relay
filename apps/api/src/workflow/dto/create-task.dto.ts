import {
  ArrayMinSize,
  ArrayNotEmpty,
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

  @ApiProperty({
    type: [String],
    description:
      'Ordered array of member UUIDs in the sequence they will work the relay. ' +
      'Step 1 goes to memberIds[0], step 2 to memberIds[1], etc. All must belong to the manager’s team.',
    example: ['d3b07384-d113-40f4-a09b-439564f9ef31', 'e4c18495-e224-51a5-b10c-540675a0fa42'],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  memberIds!: string[];
}
