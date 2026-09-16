/**
 * QVeris SDK error types.
 *
 * @module errors
 */

import type { ApiError, ApiObservability, NextAction } from './types.js';

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

  /** Machine-readable recovery guidance. Paid calls are never replayed automatically. */
  readonly next_action: NextAction;

  constructor(error: ApiError) {
    super(error.message);
    this.name = 'QverisApiError';
    this.status = error.status;
    if (error.details !== undefined) this.details = error.details;
    if (error.observability !== undefined) this.observability = error.observability;
    if (error.cause !== undefined) this.cause = error.cause;
    this.next_action =
      error.observability?.operation === 'call'
        ? recoveryFor(error.status, 'call', error.details)
        : (error.next_action ?? recoveryFor(error.status, error.observability?.operation, error.details));
  }
}

function executionIdFrom(details: unknown): string | undefined {
  if (!details || typeof details !== 'object') return undefined;
  const value = details as { execution_id?: unknown; data?: unknown };
  const direct = value.execution_id;
  if (typeof direct === 'string' && direct.trim()) return direct;
  if (!value.data || typeof value.data !== 'object') return undefined;
  const enveloped = (value.data as { execution_id?: unknown }).execution_id;
  return typeof enveloped === 'string' && enveloped.trim() ? enveloped : undefined;
}

function recoveryFor(status: number, operation?: ApiObservability['operation'], details?: unknown): NextAction {
  if (operation === 'call' && executionIdFrom(details)) {
    return action('reconcile_settlement', false, 'call_outcome_may_be_unknown');
  }
  if (status === 401) return action('authenticate', true);
  if (status === 402) return action('add_credits', true);
  if (status === 403) return action('request_permission', true);
  if (
    operation === 'call' &&
    (status === 0 || status === 408 || status === 429 || (status >= 200 && status < 300) || status >= 500)
  ) {
    return action('review_settlement', true, 'execution_id_unavailable');
  }
  if (operation === 'call' && (status === 400 || status === 422)) {
    return action('correct_parameters', true, 'invalid_call_request');
  }
  if (operation === 'call' && status >= 400 && status < 500) {
    return action('review_request', true, 'call_rejected');
  }
  if (status === 429 || status === 503 || status === 408 || status === 0) {
    return action('retry', false, 'safe_read_retry');
  }
  return action('review_and_retry', true);
}

function action(name: string, requiresUser: boolean, reason?: string): NextAction {
  return { action: name, automatic: false, requires_user: requiresUser, missing_fields: [], ...(reason && { reason }) };
}
