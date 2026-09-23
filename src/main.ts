import 'dotenv/config';

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

  app.enableCors({
    origin: true,
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

  await app.listen(3000);
}
bootstrap();
