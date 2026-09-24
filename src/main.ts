import 'dotenv/config';
import { assertProductionSecrets } from './config-check';

// Production refuses predictable secrets; local keeps zero-config fallbacks.
assertProductionSecrets();

// Safe zero-config fallbacks: allows instant running on any clone without manual .env copying
if (!process.env['DATABASE_URL']) {
  process.env['DATABASE_URL'] = 'file:./dev.db';
}
if (!process.env['JWT_SECRET']) {
  process.env['JWT_SECRET'] = 'week3-dev-secret';
}

import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './http-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Trust proxy: 1 hop by default so rate limiting sees the real client IP
  // behind Render/Nginx. Set TRUST_PROXY=0 to disable (direct exposure).
  const trustProxy = process.env['TRUST_PROXY'] || '1';
  app.getHttpAdapter().getInstance().set('trust proxy', trustProxy);

  if ((process.env['THROTTLE_STORE'] || 'memory') !== 'memory' && !process.env['REDIS_URL']) {
    console.warn('[throttle] THROTTLE_STORE is set but REDIS_URL is missing — falling back to in-memory limits.');
  }

  // Production CORS: allow-list via CORS_ORIGINS (comma-separated).
  // Empty = reflect request origin (local dev convenience only).
  const corsOrigins = (process.env['CORS_ORIGINS'] || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  app.enableCors({
    origin: corsOrigins.length > 0 ? corsOrigins : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  // Security headers; CSP off so Swagger UI's inline scripts keep working.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.useGlobalFilters(new HttpExceptionFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Internal Operations Service Hub API')
    .setDescription(
      'Submit, route, track, and resolve employee requests. ' +
        'Authenticate via POST /auth/login, then send the returned JWT as ' +
        '`Authorization: Bearer <token>`. Demo logins: admin@acme.com, ' +
        'alice@acme.com, bob@acme.com (password Password123!).',
    )
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  const swaggerDoc = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api-docs', app, swaggerDoc);

  await app.listen(Number(process.env['PORT'] || 3000));
}
bootstrap();
