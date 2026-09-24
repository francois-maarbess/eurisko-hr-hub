import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiHealthController } from './ai-health.controller';
import { AiIntakeService } from './ai-intake.service';
import { LocalAiProvider } from './local-ai.provider';
import { GroqAiProvider } from './groq-ai.provider';

@Module({
  controllers: [AiController, AiHealthController],
  providers: [AiIntakeService, LocalAiProvider, GroqAiProvider],
  exports: [AiIntakeService],
})
export class AiModule {}
