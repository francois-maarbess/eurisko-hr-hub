import { Module, Global } from '@nestjs/common';
import { PrismaServiceProvider } from './prisma.service';

@Global()
@Module({
  providers: [PrismaServiceProvider],
  exports: [PrismaServiceProvider],
})
export class PrismaModule {}
