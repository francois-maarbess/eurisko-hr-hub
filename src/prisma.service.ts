import { Provider } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { assertProductionSecrets } from './config-check';

export const PRISMA_CLIENT_TOKEN = 'PRISMA_CLIENT';
export type PrismaService = PrismaClient;

export const PrismaServiceProvider: Provider = {
  provide: PRISMA_CLIENT_TOKEN,
  useFactory: () => {
    assertProductionSecrets();
    if (!process.env['DATABASE_URL']) {
      process.env['DATABASE_URL'] = 'file:./dev.db';
    }
    return new PrismaClient();
  },
};
