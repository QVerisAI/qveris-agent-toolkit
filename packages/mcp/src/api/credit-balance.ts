export interface CreditBalanceNormalization {
  value: number | null | undefined;
  invalid: boolean;
}

const JSON_NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/** Normalize the public number/null credit-balance contract at the HTTP boundary. */
export function normalizeCreditBalance(value: unknown): CreditBalanceNormalization {
  if (value === undefined) return { value: undefined, invalid: false };
  if (value === null) return { value: null, invalid: false };
  if (typeof value === 'number') {
    return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!JSON_NUMBER_PATTERN.test(trimmed)) return { value: null, invalid: true };
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? { value: parsed, invalid: false } : { value: null, invalid: true };
  }
  return { value: null, invalid: true };
}

/**
 * Normalize a top-level public response, or the data object in a response
 * envelope. Capability result payloads are deliberately not traversed.
 */
export function normalizeCreditBalanceResponse<T>(
  response: T,
  warn: (message: string) => void = (message) => process.stderr.write(`${message}\n`),
): T {
  if (!isRecord(response)) return response;

  const normalizedRoot = normalizeRecord(response, warn);
  if (!isRecord(normalizedRoot.data)) return normalizedRoot as T;

  const normalizedData = normalizeRecord(normalizedRoot.data, warn);
  if (normalizedData === normalizedRoot.data) return normalizedRoot as T;
  return { ...normalizedRoot, data: normalizedData } as T;
}

function normalizeRecord(record: Record<string, unknown>, warn: (message: string) => void): Record<string, unknown> {
  if (!Object.prototype.hasOwnProperty.call(record, 'remaining_credits')) return record;
  const normalized = normalizeCreditBalance(record.remaining_credits);
  if (normalized.invalid) {
    warn('[qveris] Invalid remaining_credits in API response; treating the balance as unavailable.');
  }
  if (normalized.value === record.remaining_credits) return record;
  return { ...record, remaining_credits: normalized.value };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
