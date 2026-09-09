import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';

@Module({
  imports: [],
  controllers: [RequestsController],
  providers: [RequestsService],
})
export class AppModule {}
