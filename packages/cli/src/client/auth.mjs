import { resolve } from "../config/resolve.mjs";
import { CliError } from "../errors/handler.mjs";

const PLACEHOLDER_PATTERNS = [
  /^your[_-]?(qveris)?[_-]?api[_-]?key/i,
  /^sk-1_xxx/,
  /^sk-1_$/,
  /^YOUR_/,
];

export function resolveApiKey(flagValue) {
  const { value } = resolve("api_key", flagValue);

  if (!value || !value.trim()) {
    throw new CliError("AUTH_MISSING_KEY");
  }

  const trimmed = value.trim();
  for (const pattern of PLACEHOLDER_PATTERNS) {
    if (pattern.test(trimmed)) {
      throw new CliError("AUTH_MISSING_KEY", "API key appears to be a placeholder. Set a real key.");
    }
  }

  return trimmed;
}
