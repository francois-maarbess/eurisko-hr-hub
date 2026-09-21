import { Module } from '@nestjs/common';
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

@Module({
  imports: [PrismaModule, AuthModule, AiModule],
  controllers: [
    RequestsController,
    CatalogController,
    DocumentsController,
    NotificationsController,
    DepartmentsController,
    HealthController,
  ],
  providers: [RequestsService, AuditService, NotificationsService, DocumentsService],
})
export class AppModule {}
