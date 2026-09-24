import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
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
import { HealthController } from './health.controller';
import { RequestLoggerMiddleware } from './request-logger.middleware';

@Module({
  imports: [
    // All limits env-overridable (see .env.example); code values are
    // local-dev defaults. forRoot runs after dotenv/config loads in main.
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
  ],
  providers: [
    RequestsService,
    AuditService,
    NotificationsService,
    DocumentsService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestLoggerMiddleware).forRoutes('*');
  }
}
