import { readConfig } from "./store.mjs";
import { DEFAULTS } from "./defaults.mjs";

const ENV_MAP = {
  api_key: "QVERIS_API_KEY",
  base_url: "QVERIS_BASE_URL",
  default_limit: "QVERIS_DEFAULT_LIMIT",
  default_max_size: "QVERIS_DEFAULT_MAX_SIZE",
};

export function resolve(key, flagValue) {
  if (flagValue !== undefined && flagValue !== null) return { value: flagValue, source: "flag" };

  const envVar = ENV_MAP[key];
  if (envVar && process.env[envVar]) return { value: process.env[envVar], source: `env (${envVar})` };

  const config = readConfig();
  if (config[key] !== undefined) return { value: config[key], source: "config" };

  if (DEFAULTS[key] !== undefined) return { value: DEFAULTS[key], source: "default" };

  return { value: undefined, source: "none" };
}

export function resolveAll(flags = {}) {
  const keys = new Set([...Object.keys(DEFAULTS), ...Object.keys(ENV_MAP), ...Object.keys(readConfig())]);
  const result = {};
  for (const key of keys) {
    result[key] = resolve(key, flags[key]);
  }
  return result;
}
