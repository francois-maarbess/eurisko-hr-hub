import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UpdateStatusDto {
  @IsEnum(['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'REJECTED'])
  status: 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';

  @IsOptional()
  @IsString()
  resolutionNote?: string;

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}
