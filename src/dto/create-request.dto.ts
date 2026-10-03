import { IsString, IsEnum, IsNotEmpty, MinLength, MaxLength, IsOptional, IsUUID, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateChildRequestDto {
  @ApiProperty({ description: 'ID of the department that owns this child request.' })
  @IsString() @IsNotEmpty() departmentId: string;

  @ApiProperty({ description: 'ID of a request type belonging to the selected department.' })
  @IsString() @IsNotEmpty() requestTypeId: string;

  @ApiProperty({ minLength: 8, maxLength: 240 })
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(240) title: string;

  @ApiProperty({ minLength: 8, maxLength: 400 })
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(400) description: string;

  @ApiProperty({ enum: ['LOW', 'STANDARD', 'URGENT'], default: 'STANDARD' })
  @IsEnum(['LOW', 'STANDARD', 'URGENT']) priority: 'LOW' | 'STANDARD' | 'URGENT' = 'STANDARD';
}

export class CreateRequestDto {
  @ApiProperty({ description: 'ID of the department that should receive this request.' })
  @IsString()
  @IsNotEmpty()
  departmentId: string;

  @ApiProperty({ description: 'ID of a request type belonging to the selected department.' })
  @IsString()
  @IsNotEmpty()
  requestTypeId: string;

  @ApiProperty({ minLength: 3, maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @ApiProperty({ minLength: 10, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @ApiProperty({ enum: ['LOW', 'STANDARD', 'URGENT'], default: 'STANDARD' })
  @IsEnum(['LOW', 'STANDARD', 'URGENT'])
  priority: 'LOW' | 'STANDARD' | 'URGENT' = 'STANDARD';

  @ApiPropertyOptional({ format: 'uuid', description: 'Optional idempotency key for safe request retries.' })
  @IsOptional()
  @IsUUID()
  submissionKey?: string;

  @ApiPropertyOptional({ type: () => [CreateChildRequestDto], maxItems: 6 })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CreateChildRequestDto)
  childTasks?: CreateChildRequestDto[];
}
