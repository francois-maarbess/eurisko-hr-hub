import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

/**
 * Minimal HTTP access log: one line per request (method, path, status,
 * duration, correlation ID). Query strings and bodies are never logged,
 * so tokens and passwords can't leak into logs. Every request carries
 * an x-request-id (client-supplied or generated) that the exception
 * filter echoes back — one ID traces a failure end to end.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const requestId = (req.headers['x-request-id'] as string) || randomUUID();
    req.headers['x-request-id'] = requestId;
    res.setHeader('x-request-id', requestId);
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      // Slow-query/route signal: one WARN line over the threshold so
      // instructors see perf issues without a metrics stack.
      const slowThreshold = Number(process.env['SLOW_LOG_MS'] || 1000);
      if (ms >= slowThreshold) {
        this.logger.warn(`[${requestId}] SLOW ${req.method} ${req.path} ${res.statusCode} ${ms}ms (>= ${slowThreshold}ms)`);
      } else {
        this.logger.log(`[${requestId}] ${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
      }
    });
    next();
  }
}
