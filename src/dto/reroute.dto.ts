import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RerouteDto {
  @IsString()
  @IsNotEmpty()
  newDepartmentId: string;

  @IsString()
  @IsNotEmpty()
  newRequestTypeId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason: string;
}
