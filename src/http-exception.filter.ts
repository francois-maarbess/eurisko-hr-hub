import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Global safety net: every thrown error becomes a predictable JSON body
 * { statusCode, message, requestId, timestamp }. Stack traces and driver
 * errors never reach the client — 500s stay opaque, 4xx stay informative.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exceptions');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const raw =
      exception instanceof HttpException ? exception.getResponse() : null;
    const message =
      typeof raw === 'string'
        ? raw
        : (raw as any)?.message || (status >= 500 ? 'Internal server error' : 'Request failed');
    const details = Array.isArray((raw as any)?.message) ? (raw as any).message : undefined;

    if (status >= 500) {
      this.logger.error(`[${requestId}] ${req.method} ${req.path} -> ${status}: ${(exception as Error)?.message}`);
    }

    res.status(status).json({
      statusCode: status,
      message,
      ...(details ? { details } : {}),
      requestId,
      timestamp: new Date().toISOString(),
    });
  }
}
