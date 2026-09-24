import { IsOptional, IsString, MaxLength } from 'class-validator';

export class AiCorrectionDto {
  @IsOptional()
  @IsString()
  @MaxLength(20)
  departmentCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  requestTypeCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
