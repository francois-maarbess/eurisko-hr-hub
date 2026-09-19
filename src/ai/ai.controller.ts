import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiIntakeService } from './ai-intake.service';

class AiDraftDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  text!: string;
}

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class AiController {
  constructor(private readonly aiIntake: AiIntakeService) {}

  @Post('ai-draft')
  @HttpCode(HttpStatus.OK)
  draft(@Body() dto: AiDraftDto) {
    return this.aiIntake.draft(dto.text);
  }
}
