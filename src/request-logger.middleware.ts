import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/**
 * Minimal HTTP access log: one line per request (method, path, status,
 * duration). Query strings and bodies are never logged, so tokens and
 * passwords can't leak into logs.
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const started = Date.now();
    res.on('finish', () => {
      const ms = Date.now() - started;
      this.logger.log(`${req.method} ${req.path} ${res.statusCode} ${ms}ms`);
    });
    next();
  }
}
