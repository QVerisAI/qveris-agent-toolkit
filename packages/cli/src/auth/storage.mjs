import { createHash } from "node:crypto";
import { getConfigValue, readConfig, writeConfig } from "../config/store.mjs";

const SERVICE = "qveris-cli";
const SECRET_CONFIG_KEY = "oauth_session_secret";
let memorySecret = null;
let memoryMetadata = null;

function accountForIssuer(issuer) {
  return `oauth-${createHash("sha256").update(issuer).digest("hex").slice(0, 24)}`;
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

export function getOAuthSessionMetadata() {
  if (memoryMetadata) return memoryMetadata;
  const value = getConfigValue("oauth_session");
  return value && typeof value === "object" && typeof value.issuer === "string" ? value : null;
}

export function hasOAuthSession() {
  return getOAuthSessionMetadata() !== null;
}

export async function saveOAuthSession(metadata, secret, { allowUnencryptedStorage = false } = {}) {
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

export async function loadOAuthSessionSecret(metadata = getOAuthSessionMetadata()) {
  if (!metadata) return null;
  if (memorySecret?.issuer === metadata.issuer) return memorySecret.secret;
  if (metadata.storage === "config") {
    const stored = getConfigValue(SECRET_CONFIG_KEY);
    if (stored?.issuer !== metadata.issuer || !stored.secret) return null;
    return typeof stored.secret.access_token === "string" ? stored.secret : null;
  }
  if (metadata.storage !== "keyring") return null;
  const entry = await keyringEntry(metadata.issuer);
  if (!entry) return null;
  try {
    const raw = entry.getPassword();
    if (!raw) return null;
    const secret = JSON.parse(raw);
    return secret && typeof secret.access_token === "string" ? secret : null;
  } catch {
    return null;
  }
}

export async function deleteOAuthSession() {
  const metadata = getOAuthSessionMetadata();
  if (metadata) {
    const entry = await keyringEntry(metadata.issuer);
    if (entry) {
      try {
        entry.deletePassword();
      } catch {
        // Local metadata must still be removed if the keyring entry is absent.
      }
    }
  }
  memorySecret = null;
  memoryMetadata = null;
  persistSessionConfig(null);
}
