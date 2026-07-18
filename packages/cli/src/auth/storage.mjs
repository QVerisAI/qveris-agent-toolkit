import { createHash } from "node:crypto";
import { deleteConfigValue, getConfigValue, setConfigValue } from "../config/store.mjs";

const SERVICE = "qveris-cli";
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

export function getOAuthSessionMetadata() {
  if (memoryMetadata) return memoryMetadata;
  const value = getConfigValue("oauth_session");
  return value && typeof value === "object" && typeof value.issuer === "string" ? value : null;
}

export function hasOAuthSession() {
  return getOAuthSessionMetadata() !== null;
}

export async function saveOAuthSession(metadata, secret) {
  const entry = await keyringEntry(metadata.issuer);
  let persisted = false;
  if (entry) {
    try {
      entry.setPassword(JSON.stringify(secret));
      persisted = true;
    } catch {
      // A desktop keyring may be unavailable in a headless session.
    }
  }
  memorySecret = { issuer: metadata.issuer, secret };
  memoryMetadata = { ...metadata, storage: persisted ? "keyring" : "session" };
  if (persisted) setConfigValue("oauth_session", memoryMetadata);
  else deleteConfigValue("oauth_session");
  return persisted;
}

export async function loadOAuthSessionSecret(metadata = getOAuthSessionMetadata()) {
  if (!metadata) return null;
  if (memorySecret?.issuer === metadata.issuer) return memorySecret.secret;
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
  deleteConfigValue("oauth_session");
}
