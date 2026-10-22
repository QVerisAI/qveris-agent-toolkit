export function outputJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function outputJsonError(error, exitCode = 1) {
  const obj = { error: error.message || String(error) };
  if (error.code) obj.code = error.code;
  if (Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) obj.status = error.status;
  if (error.hint) obj.hint = error.hint;
  obj.retryable = error.retryable ?? false;
  obj.action = error.action ?? "review_and_retry";
  obj.next_action = error.nextAction ?? {
    action: obj.action,
    automatic: false,
    requires_user: !obj.retryable,
    missing_fields: error.missingFields ?? [],
  };
  obj.missing_fields = error.missingFields ?? [];
  obj.fallback_available = error.fallbackAvailable ?? false;
  if (error.candidates !== undefined) obj.candidates = error.candidates;
  if (error.parameterErrors !== undefined) obj.parameter_errors = error.parameterErrors;
  if (error.idempotencyKey !== undefined) obj.idempotency_key = error.idempotencyKey;
  if (error.recovery !== undefined) obj.recovery = error.recovery;
  obj.exit_code = exitCode;
  process.stderr.write(JSON.stringify(obj) + "\n");
}
