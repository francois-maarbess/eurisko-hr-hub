import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma.module';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class AppModule {}
