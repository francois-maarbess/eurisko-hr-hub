import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AiIntakeService } from './ai-intake.service';

/**
 * AI observability for instructors: which provider is live, which prompt
 * version produced drafts, and when it last failed. No secrets, no keys —
 * key-present boolean only.
 */
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiHealthController {
  constructor(private readonly ai: AiIntakeService) {}

  @Get('health')
  health() {
    const status = this.ai.providerStatus();
    return {
      ...status,
      keyPresent: !!process.env['GROQ_API_KEY'],
      timestamp: new Date().toISOString(),
    };
  }
}
