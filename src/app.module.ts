import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { AiModule } from './ai/ai.module';
import { CatalogController } from './catalog.controller';

@Module({
  imports: [PrismaModule, AuthModule, AiModule],
  controllers: [RequestsController, CatalogController],
  providers: [RequestsService],
})
export class AppModule {}
