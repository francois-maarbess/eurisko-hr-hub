/**
 * Service-owned bounds for model-assisted target estimates. These are
 * operational planning targets, not response guarantees. The continuous
 * estimate may use any integer millisecond duration within these bounds.
 */
export const MIN_SLA_DURATION_MS = 15 * 60 * 1000;
export const MAX_SLA_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

const FALLBACK_HOURS: Record<string, number> = {
  URGENT: 4,
  STANDARD: 24,
  LOW: 48,
};

export function fallbackSlaDurationMs(priority: string): number {
  return (FALLBACK_HOURS[priority] ?? FALLBACK_HOURS.STANDARD) * 60 * 60 * 1000;
}

export function isAllowedSlaDuration(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= MIN_SLA_DURATION_MS &&
    (value as number) <= MAX_SLA_DURATION_MS;
}
