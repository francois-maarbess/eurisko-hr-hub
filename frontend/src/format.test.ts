import { describe, expect, it } from 'vitest';
import { formatDateTime, formatEnum, toRef } from './format';

describe('formatEnum', () => {
  it('IN_PROGRESS -> In Progress', () => {
    expect(formatEnum('IN_PROGRESS')).toBe('In Progress');
  });
  it('single word lowercases the tail', () => {
    expect(formatEnum('URGENT')).toBe('Urgent');
  });
  it('EMP_LETTER -> Emp Letter', () => {
    expect(formatEnum('EMP_LETTER')).toBe('Emp Letter');
  });
  it('SYSTEM_ADMIN -> System Admin', () => {
    expect(formatEnum('SYSTEM_ADMIN')).toBe('System Admin');
  });
});

describe('toRef', () => {
  it('derives a stable REQ- reference from the id tail', () => {
    expect(toRef('abc123456789')).toBe('REQ-456789');
  });
  it('uses the last 6 alphanumerics uppercased', () => {
    expect(toRef('xxx-aa11bb22')).toBe('REQ-11BB22');
  });
  it('never returns an empty reference', () => {
    expect(toRef('')).toBe('REQ-000000');
    expect(toRef('---')).toBe('REQ-000000');
  });
  it('is deterministic', () => {
    expect(toRef('ticket-9f3k2a')).toBe(toRef('ticket-9f3k2a'));
  });
});

describe('formatDateTime', () => {
  it('formats a valid timestamp for the locale', () => {
    const out = formatDateTime('2026-01-15T10:30:00.000Z', 'en-US');
    expect(out).toContain('2026');
  });
  it('passes through garbage untouched', () => {
    expect(formatDateTime('not-a-date')).toBe('not-a-date');
  });
});
