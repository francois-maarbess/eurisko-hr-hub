import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Patch,
} from '@nestjs/common';
import { RequestsService, UpdateRequestStatusDto } from './requests.service';

@Controller('requests')
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Get()
  getAll() {
    return this.requestsService.getAll();
  }

  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRequestStatusDto,
  ) {
    try {
      const request = this.requestsService.updateStatus(id, dto);
      return {
        id: request.id,
        title: request.title,
        description: request.description,
        priority: request.priority,
        status: request.status,
        resolution_note: request.resolution_note,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'UNKNOWN_ERROR';

      if (message === 'REQUEST_NOT_FOUND') {
        throw new HttpException('Request not found', HttpStatus.NOT_FOUND);
      }

      if (message === 'INVALID_TRANSITION') {
        throw new HttpException(
          'Invalid status transition for this request',
          HttpStatus.BAD_REQUEST,
        );
      }

      if (message === 'RESOLUTION_NOTE_REQUIRED') {
        throw new HttpException(
          'A resolution_note is required when transitioning to COMPLETED',
          HttpStatus.BAD_REQUEST,
        );
      }

      throw new HttpException('Internal server error', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
