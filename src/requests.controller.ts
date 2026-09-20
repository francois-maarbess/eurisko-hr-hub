import {
  Body,
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { Roles, RolesGuard } from './auth/roles.guard';
import { CurrentUser } from './auth/current-user.decorator';

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  findAll(@CurrentUser() user: any, @Query('view') view?: string) {
    return this.requestsService.findAll(user.id, view);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SYSTEM_ADMIN')
  @Get('report')
  report() {
    return this.requestsService.getReport();
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.requestsService.findOne(id, { id: user.id, platformRole: user.platformRole });
  }

  @Post('check-duplicates')
  @HttpCode(HttpStatus.OK)
  checkDuplicates(
    @Body() body: { departmentId?: string; title?: string; description?: string; excludeId?: string },
  ) {
    return this.requestsService.findDuplicates({
      departmentId: body.departmentId,
      title: body.title || '',
      description: body.description,
      excludeId: body.excludeId,
    });
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
