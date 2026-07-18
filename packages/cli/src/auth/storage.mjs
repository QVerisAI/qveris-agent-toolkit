import { createHash } from "node:crypto";
import { closeSync, mkdirSync, openSync, statSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "../errors/handler.mjs";
import { getConfigPath, getConfigValue, readConfig, writeConfig } from "../config/store.mjs";

const SERVICE = "qveris-cli";
const SECRET_CONFIG_KEY = "oauth_session_secret";
const REFRESH_LOCK_STALE_MS = 60000;
const REFRESH_LOCK_WAIT_MS = 100;
const REFRESH_LOCK_TIMEOUT_MS = 65000;
let memorySecret = null;
let memoryMetadata = null;

function accountForIssuer(issuer) {
  return `oauth-${createHash("sha256").update(issuer).digest("hex").slice(0, 24)}`;
}

function isValidSecret(secret) {
  return (
    secret &&
    typeof secret.access_token === "string" &&
    secret.access_token.trim() &&
    !/[\r\n]/.test(secret.access_token) &&
    typeof secret.refresh_token === "string" &&
    secret.refresh_token.trim() &&
    !/[\r\n]/.test(secret.refresh_token)
  );
}

async function keyringEntry(issuer) {
  if (process.env.QVERIS_DISABLE_KEYRING === "1") return null;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry(SERVICE, accountForIssuer(issuer));
  } catch {
    return null;
  }
}

function persistSessionConfig(metadata, storedSecret = null) {
  const config = readConfig();
  if (metadata) config.oauth_session = metadata;
  else delete config.oauth_session;
  if (storedSecret) config[SECRET_CONFIG_KEY] = storedSecret;
  else delete config[SECRET_CONFIG_KEY];
  writeConfig(config);
}

export function getOAuthSessionMetadata({ fresh = false } = {}) {
  if (!fresh && memoryMetadata) return memoryMetadata;
  const value = getConfigValue("oauth_session");
  const metadata = value && typeof value === "object" && typeof value.issuer === "string" ? value : null;
  if (fresh) memoryMetadata = metadata;
  return metadata;
}

export function hasOAuthSession() {
  return getOAuthSessionMetadata() !== null;
}

export async function saveOAuthSession(metadata, secret, { allowUnencryptedStorage = false } = {}) {
  if (!isValidSecret(secret)) {
    throw new CliError("API_ERROR", "Refusing to store an invalid OAuth credential response");
  }
  const entry = await keyringEntry(metadata.issuer);
  let storage = "session";
  if (entry) {
    try {
      entry.setPassword(JSON.stringify(secret));
      storage = "keyring";
    } catch {
      // A desktop keyring may be unavailable in a headless session.
    }
  }
  const useConfigStorage = storage === "session" && (allowUnencryptedStorage || metadata.storage === "config");
  if (useConfigStorage) storage = "config";
  memorySecret = { issuer: metadata.issuer, secret };
  memoryMetadata = { ...metadata, storage };
  persistSessionConfig(
    storage === "session" ? null : memoryMetadata,
    storage === "config" ? { issuer: metadata.issuer, secret } : null,
  );
  return storage !== "session";
}

export async function loadOAuthSessionSecret(metadata = getOAuthSessionMetadata(), { fresh = false } = {}) {
  if (!metadata) return null;
  if (!fresh && memorySecret?.issuer === metadata.issuer) return memorySecret.secret;
  if (metadata.storage === "config") {
    const stored = getConfigValue(SECRET_CONFIG_KEY);
    if (stored?.issuer !== metadata.issuer || !stored.secret) return null;
    const secret = isValidSecret(stored.secret) ? stored.secret : null;
    if (fresh) memorySecret = secret ? { issuer: metadata.issuer, secret } : null;
    return secret;
  }
  if (metadata.storage !== "keyring") return null;
  const entry = await keyringEntry(metadata.issuer);
  if (!entry) {
    if (fresh) memorySecret = null;
    return null;
  }
  try {
    const raw = entry.getPassword();
    if (!raw) return null;
    const secret = JSON.parse(raw);
    const validated = isValidSecret(secret) ? secret : null;
    if (fresh) memorySecret = validated ? { issuer: metadata.issuer, secret: validated } : null;
    return validated;
  } catch {
    if (fresh) memorySecret = null;
    return null;
  }
}

export async function withOAuthRefreshLock(
  callback,
  { sleep = (milliseconds) => delay(milliseconds), now = () => Date.now() } = {},
) {
  const lockPath = `${getConfigPath()}.oauth-refresh.lock`;
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  const deadline = now() + REFRESH_LOCK_TIMEOUT_MS;
  let descriptor;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (now() - statSync(lockPath).mtimeMs >= REFRESH_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch (statError) {
        if (statError?.code === "ENOENT") continue;
        throw statError;
      }
      if (now() >= deadline) {
        throw new CliError("NET_TIMEOUT", "Timed out waiting for another QVeris process to refresh OAuth credentials");
      }
      await sleep(REFRESH_LOCK_WAIT_MS);
    }
  }
  let result;
  let callbackError;
  try {
    result = await callback();
  } catch (error) {
    callbackError = error;
  }
  let cleanupError;
  try {
    closeSync(descriptor);
    unlinkSync(lockPath);
  } catch (error) {
    if (error?.code !== "ENOENT") cleanupError = error;
  }
  if (callbackError) throw callbackError;
  if (cleanupError) throw cleanupError;
  return result;
}

export async function deleteOAuthSession() {
  const metadata = getOAuthSessionMetadata();
  let keyringError = null;
  if (metadata?.storage === "keyring") {
    const entry = await keyringEntry(metadata.issuer);
    if (!entry) {
      keyringError = new CliError(
        "API_ERROR",
        "The operating-system credential store is unavailable; OAuth credentials were not removed",
      );
    } else {
      try {
        entry.deletePassword();
      } catch (error) {
        keyringError = new CliError(
          "API_ERROR",
          `OAuth credentials could not be removed from the operating-system credential store${error?.message ? `: ${error.message}` : ""}`,
        );
      }
    }
  }
  memorySecret = null;
  if (keyringError) {
    memoryMetadata = metadata;
    persistSessionConfig(metadata);
    throw keyringError;
  }
  memoryMetadata = null;
  persistSessionConfig(null);
}
