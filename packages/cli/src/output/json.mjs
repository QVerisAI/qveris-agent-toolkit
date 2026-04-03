export function outputJson(data) {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
}

export function outputJsonError(error, exitCode = 1) {
  const obj = { error: error.message || String(error) };
  if (error.code) obj.code = error.code;
  if (error.hint) obj.hint = error.hint;
  obj.exit_code = exitCode;
  process.stderr.write(JSON.stringify(obj) + "\n");
}
