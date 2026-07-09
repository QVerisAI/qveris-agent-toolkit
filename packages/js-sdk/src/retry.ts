/**
 * Rate-limit aware retry helpers for the QVeris client.
 *
 * Pure functions the client uses to decide whether and how long to wait before
 * retrying a rate-limited (`429`) or transient (`503`) response — honoring the
 * `Retry-After` header when present, otherwise exponential backoff with full
 * jitter. Kept separate from the client so the delay math is unit-testable.
 *
 * @module @qverisai/sdk/retry
 */

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 60_000;
const MAX_BACKOFF_EXPONENT = 30; // guards 2**attempt against overflow

/** HTTP statuses worth retrying: rate limiting + transient unavailability. */
export const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * Parse a `Retry-After` header into milliseconds.
 *
 * Accepts both RFC 9110 forms — a delta in seconds (`"12"`) or an HTTP-date.
 * Returns `null` when absent/unparseable, and never a negative value.
 */
export function parseRetryAfterMs(value: string | null | undefined, now: number = Date.now()): number | null {
  if (value == null) return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;

  // Delta-seconds form: a non-negative integer.
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }

  // HTTP-date form. Require a letter (month name / "GMT") so Date.parse's
  // leniency doesn't turn junk like "-5" into a spurious date.
  if (!/[a-zA-Z]/.test(trimmed)) return null;
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now);
}

export interface RetryDelayOptions {
  /** Parsed `Retry-After` in ms, or null to use backoff. */
  retryAfterMs: number | null;
  /** Zero-based attempt index (0 = first retry). */
  attempt: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Jitter source in [0, 1); defaults to `Math.random`. */
  random?: () => number;
}

/**
 * Compute how long to wait before the next attempt, in milliseconds.
 *
 * Honors `retryAfterMs` (capped at `maxDelayMs`); otherwise exponential backoff
 * `baseDelayMs * 2**attempt` with full jitter, capped at `maxDelayMs`.
 */
export function computeRetryDelayMs(options: RetryDelayOptions): number {
  const { retryAfterMs, attempt, baseDelayMs, maxDelayMs } = options;
  if (retryAfterMs != null) {
    return Math.min(retryAfterMs, maxDelayMs);
  }
  const random = options.random ?? Math.random;
  const capped = Math.min(baseDelayMs * 2 ** Math.min(attempt, MAX_BACKOFF_EXPONENT), maxDelayMs);
  return capped * (0.5 + 0.5 * random());
}

/** Resolve a caller-supplied `maxRetries` to a safe non-negative integer. */
export function resolveMaxRetries(maxRetries: number | undefined): number {
  if (maxRetries == null || !Number.isFinite(maxRetries)) return DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.floor(maxRetries));
}
