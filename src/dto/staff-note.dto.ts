import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class StaffNoteDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  content!: string;
}
