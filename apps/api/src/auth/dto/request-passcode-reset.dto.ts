import { IsEmail, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const normaliseEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

export class RequestPasscodeResetDto {
  @ApiProperty({ format: 'email', maxLength: 254, example: 'member@acme.test' })
  @IsEmail()
  @Transform(normaliseEmail)
  @MaxLength(254)
  email!: string;
}
