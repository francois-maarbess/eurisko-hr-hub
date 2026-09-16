import { Provider } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

export type PrismaService = PrismaClient;

export const PrismaServiceProvider: Provider = {
  provide: PrismaClient,
  useFactory: () => {
    return new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
        },
      },
    });
  },
};
