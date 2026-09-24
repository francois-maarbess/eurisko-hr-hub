/**
 * Production secret guard. Local/dev/test keep zero-config fallbacks
 * (instructors clone and run with nothing set); production refuses to boot
 * with predictable secrets. Call before any fallback is applied.
 */
export function assertProductionSecrets(): void {
  if (process.env['NODE_ENV'] !== 'production') return;
  const missing: string[] = [];
  if (!process.env['JWT_SECRET']) missing.push('JWT_SECRET');
  if (!process.env['DATABASE_URL']) missing.push('DATABASE_URL');
  if (missing.length > 0) {
    throw new Error(
      `Refusing to boot in production without ${missing.join(' and ')}. ` +
        'Set them in the environment — never commit secrets.',
    );
  }
}
