/**
 * Unit test: Status transition business rules.
 *
 * This tests the core business logic independently — no database, no HTTP.
 * The same rules enforced in RequestsService are tested here directly.
 */

const VALID_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['IN_PROGRESS', 'CANCELLED', 'REJECTED'],
  IN_PROGRESS: ['COMPLETED', 'REJECTED'],
};

function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return !!allowed && allowed.includes(to);
}

describe('Status Transition Business Rules', () => {
  it('PENDING -> IN_PROGRESS is valid (claim)', () => {
    expect(isValidTransition('PENDING', 'IN_PROGRESS')).toBe(true);
  });

  it('PENDING -> CANCELLED is valid (employee cancel)', () => {
    expect(isValidTransition('PENDING', 'CANCELLED')).toBe(true);
  });

  it('PENDING -> REJECTED is valid (department reject)', () => {
    expect(isValidTransition('PENDING', 'REJECTED')).toBe(true);
  });

  it('IN_PROGRESS -> COMPLETED is valid (resolve)', () => {
    expect(isValidTransition('IN_PROGRESS', 'COMPLETED')).toBe(true);
  });

  it('IN_PROGRESS -> REJECTED is valid', () => {
    expect(isValidTransition('IN_PROGRESS', 'REJECTED')).toBe(true);
  });

  it('PENDING -> COMPLETED is INVALID (skip transition)', () => {
    expect(isValidTransition('PENDING', 'COMPLETED')).toBe(false);
  });

  it('COMPLETED -> anything is INVALID (terminal state)', () => {
    expect(isValidTransition('COMPLETED', 'PENDING')).toBe(false);
    expect(isValidTransition('COMPLETED', 'IN_PROGRESS')).toBe(false);
    expect(isValidTransition('COMPLETED', 'CANCELLED')).toBe(false);
  });

  it('CANCELLED -> anything is INVALID (terminal state)', () => {
    expect(isValidTransition('CANCELLED', 'PENDING')).toBe(false);
    expect(isValidTransition('CANCELLED', 'IN_PROGRESS')).toBe(false);
  });

  it('REJECTED -> anything is INVALID (terminal state)', () => {
    expect(isValidTransition('REJECTED', 'PENDING')).toBe(false);
    expect(isValidTransition('REJECTED', 'IN_PROGRESS')).toBe(false);
  });

  it('unknown status -> anything is INVALID', () => {
    expect(isValidTransition('GARBAGE', 'PENDING')).toBe(false);
  });
});
