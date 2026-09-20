import { RequestsService } from './requests.service';
import { DocumentsService } from './documents.service';

const noop = { append: async () => {}, emit: async () => {}, fanout: async () => {} } as any;

describe('Retention purge (acceptance 11)', () => {
  it('drops payloads past their purge date and reports the count', async () => {
    const calls: any[] = [];
    const stubPrisma = {
      document: {
        updateMany: async (args: any) => {
          calls.push(args);
          return { count: 2 };
        },
      },
    } as any;
    const svc = new DocumentsService(stubPrisma, noop, noop);
    const count = await svc.purgeExpired(new Date('2030-01-01T00:00:00Z'));
    expect(count).toBe(2);
    expect(calls[0].where.purgeAt).toEqual({ lte: new Date('2030-01-01T00:00:00Z') });
    expect(calls[0].where.deletedAt).toBeNull();
    expect(calls[0].data).toEqual({ data: null });
  });
});

describe('Duplicate detection (advisory)', () => {
  const rows = [
    { id: 'a', title: 'Laptop screen cracked badly', status: 'PENDING', createdAt: new Date() },
    { id: 'b', title: 'VPN access for travel next week', status: 'IN_PROGRESS', createdAt: new Date() },
    { id: 'c', title: 'Employment verification letter', status: 'PENDING', createdAt: new Date() },
  ];
  const stubPrisma = {
    request: { findMany: async () => rows },
  } as any;

  it('finds open twins by shared significant words', async () => {
    const svc = new RequestsService(stubPrisma, noop, noop);
    const found = await svc.findDuplicates({ departmentId: 'd1', title: 'My laptop screen is cracked' });
    expect(found.map((r: any) => r.id)).toContain('a');
    expect(found.map((r: any) => r.id)).not.toContain('b');
  });

  it('returns nothing for unrelated text or missing department', async () => {
    const svc = new RequestsService(stubPrisma, noop, noop);
    expect(await svc.findDuplicates({ departmentId: 'd1', title: 'Zebra juggling championship finals' })).toEqual([]);
    expect(await svc.findDuplicates({ title: 'Laptop screen cracked' })).toEqual([]);
  });
});
