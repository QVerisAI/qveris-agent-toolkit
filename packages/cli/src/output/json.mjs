export function outputJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function outputJsonError(error, exitCode = 1) {
  const obj = { error: error.message || String(error) };
  if (error.code) obj.code = error.code;
  if (error.hint) obj.hint = error.hint;
  obj.retryable = error.retryable ?? false;
  obj.action = error.action ?? "review_and_retry";
  obj.missing_fields = error.missingFields ?? [];
  obj.fallback_available = error.fallbackAvailable ?? false;
  if (error.candidates !== undefined) obj.candidates = error.candidates;
  if (error.parameterErrors !== undefined) obj.parameter_errors = error.parameterErrors;
  obj.exit_code = exitCode;
  process.stderr.write(JSON.stringify(obj) + "\n");
}
