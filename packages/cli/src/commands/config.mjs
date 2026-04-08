import { getConfigPath, getConfigValue, setConfigValue, writeConfig } from "../config/store.mjs";
import { resolve, resolveAll } from "../config/resolve.mjs";
import { resolveBaseUrl } from "../config/region.mjs";
import { bold, dim, cyan } from "../output/colors.mjs";
import { outputJson } from "../output/json.mjs";

const ALLOWED_KEYS = ["api_key", "base_url", "default_limit", "default_max_size", "color", "output_format"];

export async function runConfig(subcommand, args, flags) {
  switch (subcommand) {
    case "set": return configSet(args[0], args[1], flags);
    case "get": return configGet(args[0], flags);
    case "list": return configList(flags);
    case "reset": return configReset(flags);
    case "path": return configPath(flags);
    default:
      console.error(`  Unknown config subcommand: ${subcommand}`);
      console.error(`  Usage: qveris config <set|get|list|reset|path>`);
      process.exitCode = 2;
  }
}

function configSet(key, value, flags) {
  if (!key || value === undefined) {
    console.error("  Usage: qveris config set <key> <value>");
    process.exitCode = 2;
    return;
  }
  if (!ALLOWED_KEYS.includes(key)) {
    console.error(`  Unknown config key: ${key}`);
    console.error(`  Allowed: ${ALLOWED_KEYS.join(", ")}`);
    process.exitCode = 2;
    return;
  }
  let parsed = value;
  if (key.endsWith("limit") || key.endsWith("size")) {
    parsed = parseInt(value, 10);
    if (isNaN(parsed)) {
      console.error(`  Error: ${key} must be a valid integer.`);
      process.exitCode = 2;
      return;
    }
  }
  setConfigValue(key, parsed);
  if (flags.json) {
    outputJson({ key, value: parsed });
  } else {
    console.log(`  ${key} = ${bold(String(parsed))}`);
  }
}

function configGet(key, flags) {
  if (!key) {
    console.error("  Usage: qveris config get <key>");
    process.exitCode = 2;
    return;
  }
  const val = getConfigValue(key);
  if (flags.json) {
    outputJson({ key, value: val ?? null });
  } else {
    console.log(val !== undefined ? `  ${key} = ${bold(String(val))}` : `  ${key} is not set`);
  }
}

function configList(flags) {
  const all = resolveAll();

  // Resolve effective region
  const { value: apiKey } = resolve("api_key", flags.apiKey);
  const { region, source: regionSource, baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl, apiKey });

  if (flags.json) {
    const obj = {};
    for (const [k, v] of Object.entries(all)) {
      obj[k] = { value: k === "api_key" && v.value ? mask(v.value) : v.value, source: v.source };
    }
    obj._region = { region, source: regionSource, baseUrl };
    outputJson(obj);
    return;
  }

  console.log(`\n  ${bold("Key")}                 ${bold("Value")}                    ${bold("Source")}`);
  for (const [key, { value, source }] of Object.entries(all)) {
    const display = key === "api_key" && value ? mask(value) : String(value ?? dim("(not set)"));
    console.log(`  ${cyan(key.padEnd(20))}${display.padEnd(25)}${dim(source)}`);
  }
  console.log(`\n  ${bold("Effective region:")} ${region} ${dim(`(${regionSource})`)} → ${dim(baseUrl)}`);
  console.log();
}

function configReset() {
  writeConfig({});
  console.log("  Config reset to defaults.");
}

function configPath() {
  console.log(getConfigPath());
}

function mask(key) {
  if (typeof key !== "string" || key.length < 10) return "***";
  return key.slice(0, 6) + "..." + key.slice(-4);
}
