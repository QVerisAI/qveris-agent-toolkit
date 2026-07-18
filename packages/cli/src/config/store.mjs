import { randomUUID } from "node:crypto";
import { chmodSync, readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { CliError } from "../errors/handler.mjs";

function configDir() {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg || join(homedir(), ".config");
  return join(base, "qveris");
}

function configPath() {
  return join(configDir(), "config.json");
}

export function getConfigPath() {
  return configPath();
}

export function readConfig() {
  let raw;
  try {
    raw = readFileSync(configPath(), "utf-8");
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new CliError("API_ERROR", `QVeris config could not be read: ${configPath()}`);
  }
  let config;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new CliError(
      "API_ERROR",
      `QVeris config contains invalid JSON: ${configPath()}. Repair or remove it before continuing`,
    );
  }
  if (!config || typeof config !== "object" || Array.isArray(config)) {
    throw new CliError(
      "API_ERROR",
      `QVeris config must contain a JSON object: ${configPath()}. Repair or remove it before continuing`,
    );
  }
  return config;
}

export function writeConfig(config) {
  const dir = configDir();
  const target = configPath();
  const temporary = join(dir, `.config-${process.pid}-${randomUUID()}.tmp`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  try {
    writeFileSync(temporary, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
    chmodSync(temporary, 0o600);
    renameSync(temporary, target);
    chmodSync(target, 0o600);
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary path no longer exists after a successful rename.
    }
  }
}

export function getConfigValue(key) {
  return readConfig()[key];
}

export function setConfigValue(key, value) {
  const config = readConfig();
  config[key] = value;
  writeConfig(config);
}

export function deleteConfigValue(key) {
  const config = readConfig();
  delete config[key];
  writeConfig(config);
}
