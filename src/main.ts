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
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  await app.listen(3000);
}
bootstrap();
