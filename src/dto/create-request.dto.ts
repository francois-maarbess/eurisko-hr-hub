import { IsString, IsEnum, IsNotEmpty, MinLength, MaxLength } from 'class-validator';

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
}
