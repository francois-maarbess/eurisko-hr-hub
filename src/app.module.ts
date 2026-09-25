import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { AiModule } from './ai/ai.module';
import { CatalogController } from './catalog.controller';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { DepartmentsController } from './departments.controller';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { HealthController } from './health.controller';
import { RequestLoggerMiddleware } from './request-logger.middleware';
import { HttpExceptionFilter } from './http-exception.filter';
import { AiChatController } from './ai/ai-chat.controller';
import { AiChatService } from './ai/ai-chat.service';

@Module({
  imports: [
    // All limits env-overridable (see .env.example); code values are
    // local-dev defaults. forRoot runs after dotenv/config loads in main.
    // Storage seam (week-5): the default in-memory store is correct for a
    // single instance. To share limits across replicas, set
    // THROTTLE_STORE=redis + REDIS_URL and pass a Redis ThrottlerStorage
    // here — the per-route @Throttle() limits above stay unchanged.
    ThrottlerModule.forRoot([
      {
        name: 'default',
        ttl: Number(process.env['THROTTLE_TTL_MS'] || 60_000),
        limit: Number(process.env['THROTTLE_LIMIT'] || 100),
      },
    ]),
    PrismaModule,
    AuthModule,
    AiModule,
  ],
  controllers: [
    RequestsController,
    CatalogController,
    DocumentsController,
    NotificationsController,
    DepartmentsController,
    HealthController,
    AiChatController,
    AuditController,
  ],
  providers: [
    RequestsService,
    AuditService,
    NotificationsService,
    DocumentsService,
    AiChatService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Registered here (not only in main.ts) so e2e, tests, and any
    // Nest bootstrap get identical error shape { statusCode, message,
    // requestId, timestamp }. main.ts keeps its explicit registration.
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
