/**
 * Rate-limit aware retry helpers for the QVeris CLI client.
 *
 * Pure functions that decide whether and how long to wait before retrying a
 * rate-limited (429) or transient (503) response — honoring the `Retry-After`
 * header when present, otherwise exponential backoff with full jitter. Kept
 * separate from api.mjs so the delay math is unit-testable.
 */

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = 500;
export const DEFAULT_MAX_DELAY_MS = 60_000;
const MAX_BACKOFF_EXPONENT = 30; // guards 2**attempt against overflow

/** HTTP statuses worth retrying: rate limiting + transient unavailability. */
export const RETRYABLE_STATUS = new Set([429, 503]);

/**
 * Parse a `Retry-After` header into milliseconds. Accepts delta-seconds
 * (`"12"`) or an HTTP-date; returns null when absent/unparseable, never
 * negative. Server-controlled input, so it must never throw.
 */
export function parseRetryAfterMs(value, now = Date.now()) {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (trimmed === "") return null;
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  // A valid HTTP-date always contains a letter (month name / "GMT"); require one
  // so Date.parse's leniency doesn't turn junk like "-5" into a spurious date.
  if (!/[a-zA-Z]/.test(trimmed)) return null;
  const dateMs = Date.parse(trimmed);
  if (Number.isNaN(dateMs)) return null;
  return Math.max(0, dateMs - now);
}

/**
 * How long to wait before the next attempt, in milliseconds. Honors
 * `retryAfterMs` (capped at `maxDelayMs`), otherwise exponential backoff
 * `baseDelayMs * 2**attempt` with full jitter, capped at `maxDelayMs`.
 */
export function computeRetryDelayMs({ retryAfterMs, attempt, baseDelayMs, maxDelayMs, random = Math.random }) {
  if (retryAfterMs != null) return Math.min(retryAfterMs, maxDelayMs);
  const capped = Math.min(baseDelayMs * 2 ** Math.min(attempt, MAX_BACKOFF_EXPONENT), maxDelayMs);
  return capped * (0.5 + 0.5 * random());
}

/** Resolve a caller/env-supplied max-retries value to a safe non-negative int. */
export function resolveMaxRetries(value) {
  // Number('') === 0, so an env var set to an empty string would silently
  // disable retries; treat blank as unset (default) instead.
  if (value === undefined || (typeof value === "string" && value.trim() === "")) {
    return DEFAULT_MAX_RETRIES;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_RETRIES;
  return Math.max(0, Math.floor(n));
}

/** Sleep for `ms` (no-op for non-positive values). */
export function sleep(ms) {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}
