import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { Throttle } from '@nestjs/throttler';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { AiChatService } from './ai-chat.service';

class AiChatDto {
  @IsOptional() @IsString() @MaxLength(80) sessionId?: string;
  @IsOptional() @IsString() @MaxLength(2000) message?: string;
  @IsOptional() @IsString() @MaxLength(80) confirmationId?: string;
  @IsOptional() @IsIn(['confirm', 'cancel']) confirmationAction?: 'confirm' | 'cancel';
}

@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AiChatController {
  constructor(private readonly chat: AiChatService) {}

  @Post('chat')
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  chatMessage(@Body() dto: AiChatDto, @CurrentUser() user: any) {
    return this.chat.chat(user, dto);
  }
}
