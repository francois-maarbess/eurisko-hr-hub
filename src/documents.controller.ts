import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { DocumentsService } from './documents.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { CurrentUser } from './auth/current-user.decorator';

/** Strip header-injection characters; fall back to a safe name. */
function safeFilename(name: string): string {
  const clean = (name || '').replace(/["\\\r\n]/g, '').replace(/[^\x20-\x7E]/g, '').trim();
  return clean || 'attachment';
}

@Controller('requests')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  constructor(private readonly documentsService: DocumentsService) {}

  @Post(':requestId/documents')
  @Throttle({ default: { limit: Number(process.env['UPLOAD_THROTTLE_LIMIT'] || 20), ttl: 60000 } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(
    @Param('requestId') requestId: string,
    @UploadedFile() file: Express.Multer.File,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.upload(
      requestId,
      {
        originalname: file?.originalname || '',
        mimetype: file?.mimetype || '',
        size: file?.size || 0,
        buffer: file?.buffer || Buffer.alloc(0),
      },
      { id: user.id, platformRole: user.platformRole },
    );
  }

  @Get(':requestId/documents')
  list(@Param('requestId') requestId: string, @CurrentUser() user: any) {
    return this.documentsService.list(requestId, { id: user.id, platformRole: user.platformRole });
  }

  @Get(':requestId/documents/:docId/download')
  async download(
    @Param('requestId') requestId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const doc = await this.documentsService.download(requestId, docId, {
      id: user.id,
      platformRole: user.platformRole,
    });
    res.set({
      'Content-Type': doc.contentType,
      'Content-Disposition': `attachment; filename="${safeFilename(doc.filename)}"`,
      'X-Checksum': doc.checksum,
    });
    return res.send(doc.content);
  }

  @Delete(':requestId/documents/:docId')
  remove(
    @Param('requestId') requestId: string,
    @Param('docId') docId: string,
    @CurrentUser() user: any,
  ) {
    return this.documentsService.remove(requestId, docId, { id: user.id, platformRole: user.platformRole });
  }
}
