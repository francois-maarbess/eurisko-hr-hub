import { Provider } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

export type PrismaService = PrismaClient;

export const PrismaServiceProvider: Provider = {
  provide: PrismaClient,
  useFactory: () => {
    const adapter = new PrismaBetterSqlite3({
      url: process.env.DATABASE_URL || 'file:./prisma/dev.db',
    });
    return new PrismaClient({ adapter });
  },
};
