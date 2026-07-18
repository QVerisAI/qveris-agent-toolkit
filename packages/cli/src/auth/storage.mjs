import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  futimesSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { CliError } from "../errors/handler.mjs";
import { getConfigPath, getConfigValue, readConfig, writeConfig } from "../config/store.mjs";

const SERVICE = "qveris-cli";
const SECRET_CONFIG_KEY = "oauth_session_secret";
const REFRESH_LOCK_STALE_MS = 60000;
const REFRESH_LOCK_HEARTBEAT_MS = 10000;
const REFRESH_LOCK_WAIT_MS = 100;
const REFRESH_LOCK_TIMEOUT_MS = 65000;
const MAX_OAUTH_TOKEN_LENGTH = 16384;
let memorySecret = null;
let memoryMetadata = null;

function accountForIssuer(issuer) {
  return `oauth-${createHash("sha256").update(issuer).digest("hex").slice(0, 24)}`;
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function isValidSecret(secret) {
  const validToken = (value, { allowInternalSpaces = false } = {}) =>
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    value.length <= MAX_OAUTH_TOKEN_LENGTH &&
    Array.from(value).every((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint >= (allowInternalSpaces ? 0x20 : 0x21) && codePoint <= 0x7e;
    });
  return secret && validToken(secret.access_token) && validToken(secret.refresh_token, { allowInternalSpaces: true });
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
  let previousKeyringSecret = null;
  let keyringWriteError = null;
  if (entry) {
    try {
      previousKeyringSecret = entry.getPassword();
      entry.setPassword(JSON.stringify(secret));
      storage = "keyring";
    } catch (error) {
      keyringWriteError = error;
      // A desktop keyring may be unavailable in a headless session.
    }
  }
  if (storage === "session" && metadata.storage === "keyring") {
    throw new CliError(
      "API_ERROR",
      `Rotated OAuth credentials could not be persisted in the operating-system credential store${keyringWriteError?.message ? `: ${keyringWriteError.message}` : ""}`,
    );
  }
  const useConfigStorage = storage === "session" && (allowUnencryptedStorage || metadata.storage === "config");
  if (useConfigStorage) storage = "config";
  const nextMemorySecret = { issuer: metadata.issuer, secret };
  const nextMemoryMetadata = { ...metadata, storage };
  try {
    persistSessionConfig(
      storage === "session" ? null : nextMemoryMetadata,
      storage === "config" ? nextMemorySecret : null,
    );
  } catch (error) {
    if (storage === "keyring") {
      try {
        if (previousKeyringSecret) entry.setPassword(previousKeyringSecret);
        else entry.deletePassword();
      } catch (rollbackError) {
        throw new CliError(
          "API_ERROR",
          `OAuth session metadata could not be saved and the credential-store rollback failed${rollbackError?.message ? `: ${rollbackError.message}` : ""}`,
        );
      }
    }
    throw error;
  }
  memorySecret = nextMemorySecret;
  memoryMetadata = nextMemoryMetadata;
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
  const ownerToken = randomUUID();
  const ownerRecord = JSON.stringify({ ownerToken, pid: process.pid });
  const ownerPath = `${lockPath}.${ownerToken}.owner`;
  mkdirSync(dirname(lockPath), { recursive: true, mode: 0o700 });
  writeFileSync(ownerPath, ownerRecord, { encoding: "utf8", flag: "wx", mode: 0o600 });
  const deadline = now() + REFRESH_LOCK_TIMEOUT_MS;
  let descriptor;
  try {
    while (descriptor === undefined) {
      let published = false;
      try {
        // A hard link publishes the fully written owner record atomically. Other
        // contenders can never observe the empty/partial lock created by open+write.
        linkSync(ownerPath, lockPath);
        published = true;
        descriptor = openSync(lockPath, "r+");
      } catch (error) {
        if (published) {
          try {
            if (readFileSync(lockPath, "utf8") === ownerRecord) unlinkSync(lockPath);
          } catch {
            // Preserve the descriptor-open failure.
          }
        }
        if (error?.code !== "EEXIST") throw error;
        try {
          const firstStat = statSync(lockPath);
          if (now() - firstStat.mtimeMs >= REFRESH_LOCK_STALE_MS) {
            let record;
            try {
              record = JSON.parse(readFileSync(lockPath, "utf8"));
            } catch {
              // An invalid record is not safe to unlink: it may belong to a
              // replacement owner that is still being observed by this process.
            }
            const secondStat = statSync(lockPath);
            const recordIsStable =
              firstStat.dev === secondStat.dev &&
              firstStat.ino === secondStat.ino &&
              firstStat.size === secondStat.size &&
              firstStat.mtimeMs === secondStat.mtimeMs;
            if (recordIsStable && record?.ownerToken && !isProcessAlive(record.pid)) {
              unlinkSync(lockPath);
              continue;
            }
          }
        } catch (statError) {
          if (statError?.code === "ENOENT") continue;
          throw statError;
        }
        if (now() >= deadline) {
          throw new CliError(
            "NET_TIMEOUT",
            `Timed out waiting for another QVeris process to update credentials. If no QVeris process is running, remove the stale lock: ${lockPath}`,
          );
        }
        await sleep(REFRESH_LOCK_WAIT_MS);
      }
    }
    try {
      unlinkSync(ownerPath);
    } catch {
      // The lock path retains the same inode and complete owner record.
    }
  } catch (error) {
    try {
      unlinkSync(ownerPath);
    } catch {
      // Preserve the lock acquisition error.
    }
    throw error;
  }
  let result;
  let callbackError;
  const heartbeat = setInterval(() => {
    try {
      const timestamp = new Date();
      futimesSync(descriptor, timestamp, timestamp);
    } catch {
      // Cleanup below reports lock failures that affect ownership.
    }
  }, REFRESH_LOCK_HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    result = await callback();
  } catch (error) {
    callbackError = error;
  } finally {
    clearInterval(heartbeat);
  }
  try {
    closeSync(descriptor);
    if (readFileSync(lockPath, "utf8") === ownerRecord) unlinkSync(lockPath);
  } catch {
    // The stale-lock recovery path can reclaim this owner after the process exits.
    // Do not turn a committed credential transaction into an ambiguous failure.
  }
  if (callbackError) throw callbackError;
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
