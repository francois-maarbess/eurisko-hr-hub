import { IsOptional, IsString } from 'class-validator';

export class TakeoverDto {
  @IsOptional()
  @IsString()
  reason?: string;
}

export class ReassignDto {
  @IsString()
  userId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}
