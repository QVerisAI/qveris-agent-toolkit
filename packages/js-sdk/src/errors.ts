/**
 * QVeris SDK error types.
 *
 * @module errors
 */

import type { ApiError, ApiObservability } from './types.js';

/**
 * Error thrown for any failed QVeris API interaction: HTTP errors,
 * failure envelopes, timeouts, and network failures.
 *
 * Carries the same shape as the wire-level {@link ApiError} so callers can
 * branch on `status` and inspect `observability` for diagnostics.
 */
export class QverisApiError extends Error implements ApiError {
  /** HTTP status code (0 for network errors, 408 for timeouts) */
  readonly status: number;

  /** Original error details if available */
  readonly details?: unknown;

  /** Request metadata for diagnosing API failures */
  readonly observability?: ApiObservability;

  /** Lower-level transport or runtime cause when available */
  readonly cause?: string;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'QverisApiError';
    this.status = error.status;
    if (error.details !== undefined) this.details = error.details;
    if (error.observability !== undefined) this.observability = error.observability;
    if (error.cause !== undefined) this.cause = error.cause;
  }
}
