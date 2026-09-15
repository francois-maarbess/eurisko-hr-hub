import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser } from './auth/current-user.decorator';

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  findAll() {
    return this.requestsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.requestsService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateRequestDto, @CurrentUser() user: any) {
    return this.requestsService.create(dto, user.id);
  }

  @Patch(':id/claim')
  @HttpCode(HttpStatus.OK)
  claim(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.claim(id, user.id);
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: any,
  ) {
    return this.requestsService.updateStatus(id, dto, user.id);
  }
}
