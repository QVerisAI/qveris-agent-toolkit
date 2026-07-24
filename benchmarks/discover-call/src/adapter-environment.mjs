const BLOCKED_NAMES = new Set([
  'BENCHMARK_PR_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
  'NODE_AUTH_TOKEN',
  'NPM_TOKEN',
  'PYPI_API_TOKEN',
]);

export function stripAdapterSecrets(env) {
  for (const name of Object.keys(env)) {
    const normalized = name.toUpperCase();
    if (normalized.startsWith('QVERIS_') || normalized.startsWith('ACTIONS_') || BLOCKED_NAMES.has(normalized)) {
      delete env[name];
    }
  }
}
