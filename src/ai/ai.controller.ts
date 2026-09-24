import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
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
  @Throttle({ default: { limit: Number(process.env['AI_THROTTLE_LIMIT'] || 30), ttl: 60000 } })
  draft(@Body() dto: AiDraftDto) {
    return this.aiIntake.draft(dto.text);
  }
}
