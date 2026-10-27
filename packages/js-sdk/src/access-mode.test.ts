import { describe, expect, it } from 'vitest';
import { assertOperationAccess, resolveAccessMode } from './access-mode.js';

describe('explicit public read-only access', () => {
  it('keeps missing credentials in authenticated mode unless explicitly enabled', () => {
    expect(resolveAccessMode()).toBe('authenticated');
    expect(resolveAccessMode(false, true)).toBe('authenticated');
    expect(resolveAccessMode(true)).toBe('public-read-only');
    expect(() => resolveAccessMode('true' as unknown as boolean)).toThrow(/explicit boolean/);
  });

  it('rejects configured credentials without trying to validate them or falling back', () => {
    expect(() => resolveAccessMode(true, true)).toThrow(/cannot be combined with credentials/);
  });

  it('rejects authentication headers by presence and keeps default authenticated behavior', () => {
    const cases: ConstructorParameters<typeof Headers>[0][] = [
      { Authorization: 'Bearer valid-synthetic' },
      { authorization: 'Bearer invalid-synthetic' },
      { AUTHORIZATION: '' },
      { Authorization: 'malformed' },
      [
        ['Authorization', ''],
        ['Authorization', 'Bearer synthetic'],
      ],
      new Headers({ Authorization: '' }),
      { Cookie: '' },
      new Headers({ cookie: 'synthetic-session=value' }),
    ];
    for (const headers of cases) {
      expect(() => resolveAccessMode(true, false, { headers })).toThrow(/cannot be combined with credentials/);
      expect(resolveAccessMode(false, false, { headers })).toBe('authenticated');
    }
    expect(() => resolveAccessMode(true, false, { hasSessionProof: true })).toThrow(
      /cannot be combined with credentials/,
    );
    expect(resolveAccessMode(true, false, { headers: { 'Content-Type': 'application/json' } })).toBe(
      'public-read-only',
    );
  });

  it('allows only the two public read operations and keeps authenticated operations available', () => {
    for (const operation of ['discover', 'inspect']) {
      expect(() => assertOperationAccess('public-read-only', operation)).not.toThrow();
    }
    for (const operation of [
      'probe',
      'call',
      'credits',
      'usage_history',
      'credits_ledger',
      'capability_query',
      'models',
    ]) {
      expect(() => assertOperationAccess('public-read-only', operation)).toThrow(/only supports Discover and Inspect/);
      expect(() => assertOperationAccess('authenticated', operation)).not.toThrow();
    }
  });
});
