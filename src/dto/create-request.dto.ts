import { IsString, IsEnum, IsNotEmpty, MinLength, MaxLength, IsOptional, IsUUID, IsArray, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateChildRequestDto {
  @IsString() @IsNotEmpty() departmentId: string;
  @IsString() @IsNotEmpty() requestTypeId: string;
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(240) title: string;
  @IsString() @IsNotEmpty() @MinLength(8) @MaxLength(400) description: string;
  @IsEnum(['LOW', 'STANDARD', 'URGENT']) priority: 'LOW' | 'STANDARD' | 'URGENT' = 'STANDARD';
}

export class CreateRequestDto {
  @IsString()
  @IsNotEmpty()
  departmentId: string;

  @IsString()
  @IsNotEmpty()
  requestTypeId: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  @IsEnum(['LOW', 'STANDARD', 'URGENT'])
  priority: 'LOW' | 'STANDARD' | 'URGENT' = 'STANDARD';

  @IsOptional()
  @IsUUID()
  submissionKey?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @ValidateNested({ each: true })
  @Type(() => CreateChildRequestDto)
  childTasks?: CreateChildRequestDto[];
}
