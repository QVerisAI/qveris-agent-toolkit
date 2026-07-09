import { describe, expect, it } from 'vitest';

import {
  computeRetryDelayMs,
  DEFAULT_MAX_RETRIES,
  parseRetryAfterMs,
  resolveMaxRetries,
} from './retry.js';

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds into milliseconds', () => {
    expect(parseRetryAfterMs('12')).toBe(12_000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses an HTTP-date relative to now, clamped at 0', () => {
    const now = Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfterMs('Thu, 01 Jan 2020 00:00:00 GMT', now)).toBe(0);
  });

  it('returns null for absent/invalid values (never throws)', () => {
    for (const junk of [null, undefined, '', 'not-a-date', '-5', '12.5', '²']) {
      expect(parseRetryAfterMs(junk)).toBeNull();
    }
  });
});

describe('computeRetryDelayMs', () => {
  const base = { baseDelayMs: 500, maxDelayMs: 60_000 };

  it('honors Retry-After, capped at maxDelayMs', () => {
    expect(computeRetryDelayMs({ ...base, retryAfterMs: 2_000, attempt: 0 })).toBe(2_000);
    expect(computeRetryDelayMs({ ...base, retryAfterMs: 999_999, attempt: 0 })).toBe(60_000);
  });

  it('backs off exponentially with full jitter when no Retry-After', () => {
    const full = (attempt: number) =>
      computeRetryDelayMs({ ...base, retryAfterMs: null, attempt, random: () => 1 });
    expect(full(0)).toBe(500);
    expect(full(1)).toBe(1_000);
    expect(full(2)).toBe(2_000);
    expect(computeRetryDelayMs({ ...base, retryAfterMs: null, attempt: 0, random: () => 0 })).toBe(250);
  });

  it('never overflows at a huge attempt', () => {
    expect(computeRetryDelayMs({ ...base, retryAfterMs: null, attempt: 5000, random: () => 1 })).toBe(60_000);
  });
});

describe('resolveMaxRetries', () => {
  it('defaults, clamps, and floors (string env values)', () => {
    expect(resolveMaxRetries(undefined)).toBe(DEFAULT_MAX_RETRIES);
    expect(resolveMaxRetries('5')).toBe(5);
    expect(resolveMaxRetries('0')).toBe(0);
    expect(resolveMaxRetries('-3')).toBe(0);
    expect(resolveMaxRetries('2.9')).toBe(2);
    expect(resolveMaxRetries('nope')).toBe(DEFAULT_MAX_RETRIES);
    // An env var set to '' must fall back to the default, not disable retries.
    expect(resolveMaxRetries('')).toBe(DEFAULT_MAX_RETRIES);
    expect(resolveMaxRetries('  ')).toBe(DEFAULT_MAX_RETRIES);
  });
});
