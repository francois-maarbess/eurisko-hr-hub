import { assertProductionSecrets } from './config-check';

describe('assertProductionSecrets', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('does nothing outside production (zero-config local keeps working)', () => {
    process.env['NODE_ENV'] = 'development';
    delete process.env['JWT_SECRET'];
    delete process.env['DATABASE_URL'];
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it('does nothing when NODE_ENV is unset', () => {
    delete process.env['NODE_ENV'];
    delete process.env['JWT_SECRET'];
    expect(() => assertProductionSecrets()).not.toThrow();
  });

  it('throws in production without secrets', () => {
    process.env['NODE_ENV'] = 'production';
    delete process.env['JWT_SECRET'];
    delete process.env['DATABASE_URL'];
    expect(() => assertProductionSecrets()).toThrow(/JWT_SECRET/);
  });

  it('passes in production when secrets are set', () => {
    process.env['NODE_ENV'] = 'production';
    process.env['JWT_SECRET'] = 'test-secret';
    process.env['DATABASE_URL'] = 'file:./test.db';
    expect(() => assertProductionSecrets()).not.toThrow();
  });
});
