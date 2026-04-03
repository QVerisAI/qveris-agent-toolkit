import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

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
  try {
    return JSON.parse(readFileSync(configPath(), "utf-8"));
  } catch {
    return {};
  }
}

export function writeConfig(config) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2) + "\n");
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
