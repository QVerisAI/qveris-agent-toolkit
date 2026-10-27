import { randomUUID } from "node:crypto";
import { readConfig, writeConfig } from "../config/store.mjs";
import { normalizeBaseUrl } from "../config/endpoint.mjs";
import { CliError } from "../errors/handler.mjs";
import { hasOAuthSession, withOAuthRefreshLock } from "./storage.mjs";

const JOURNAL = "trial_registration";
const SECRET_CONFIG_KEY = "trial_registration_secret";

async function keyringEntry(operationId) {
  if (process.env.QVERIS_DISABLE_KEYRING === "1") return null;
  try {
    const { Entry } = await import("@napi-rs/keyring");
    return new Entry("qveris-cli", `trial-${operationId}`);
  } catch {
    return null;
  }
}

export function validSecret(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 16384 &&
    value === value.trim() &&
    !Array.from(value).some((character) => character.charCodeAt(0) <= 32 || character.charCodeAt(0) > 126)
  );
}

export function validTrialData(data) {
  return (
    data &&
    validSecret(data.api_key) &&
    validSecret(data.claim_code) &&
    validSecret(data.agent_id) &&
    data.agent_id.length <= 200 &&
    typeof data.trial_credits === "number" &&
    Number.isFinite(data.trial_credits) &&
    data.trial_credits >= 0 &&
    typeof data.expires_at === "string" &&
    /(Z|[+-]\d\d:\d\d)$/.test(data.expires_at) &&
    Number.isFinite(Date.parse(data.expires_at))
  );
}

// Inject storage boundaries for crash/failure tests without accessing an OS keyring.
export function createTrialStorage({
  read = readConfig,
  write = writeConfig,
  lock = withOAuthRefreshLock,
  entryFor = keyringEntry,
  hasOAuth = hasOAuthSession,
} = {}) {
  function getTrialRegistration() {
    const value = read()[JOURNAL];
    if (value === undefined) return null;
    if (
      !value ||
      typeof value !== "object" ||
      typeof value.operation_id !== "string" ||
      !value.operation_id ||
      !["pending", "unknown", "issued", "rejected", "logged_out"].includes(value.state) ||
      !["keyring", "config"].includes(value.storage)
    ) {
      throw new CliError("TRIAL_STORAGE_FAILED", "Stored trial registration is malformed; preserve it for recovery");
    }
    normalizeBaseUrl(value.base_url);
    return value;
  }

  function hasStoredTrialCredential() {
    const registration = getTrialRegistration();
    return registration?.state === "issued" && registration.active === true;
  }

  async function beginTrialRegistration({ baseUrl, allowUnencryptedStorage, apiKeyFlag }) {
    baseUrl = normalizeBaseUrl(baseUrl);
    return lock(async () => {
      const config = read();
      const previous = getTrialRegistration();
      if (previous && previous.state !== "rejected") return { created: false, registration: previous };
      if (apiKeyFlag !== undefined || process.env.QVERIS_API_KEY || config.api_key !== undefined || hasOAuth())
        throw new CliError("TRIAL_CREDENTIAL_EXISTS");
      const operationId = randomUUID();
      let storage = "keyring";
      const entry = await entryFor(operationId);
      const provisional = JSON.stringify({ operation_id: operationId, base_url: baseUrl, state: "prepared" });
      try {
        if (!entry) throw new Error("No keyring");
        entry.setPassword(provisional);
        if (entry.getPassword() !== provisional) throw new Error("Credential store verification failed");
      } catch {
        try {
          entry?.deletePassword();
        } catch {
          /* No account has been issued. */
        }
        if (!allowUnencryptedStorage) throw new CliError("TRIAL_STORAGE_REQUIRED");
        storage = "config";
      }
      const registration = { operation_id: operationId, state: "pending", base_url: baseUrl, storage };
      try {
        write({ ...config, [JOURNAL]: registration });
      } catch (error) {
        try {
          entry?.deletePassword();
        } catch {
          /* No registration was sent. */
        }
        throw error;
      }
      return { created: true, registration };
    });
  }

  async function recordTrialFailure(registration, { rejected = false } = {}) {
    return lock(async () => {
      const config = read();
      const current = getTrialRegistration();
      // A filesystem error can occur after an atomic rename succeeded. Never
      // downgrade an issued result, nor revive a concurrent logout/reset.
      if (current?.operation_id !== registration.operation_id || !["pending", "unknown"].includes(current.state))
        return;
      write({ ...config, [JOURNAL]: { ...current, state: rejected ? "rejected" : "unknown" } });
    });
  }

  function issuedMetadata(registration, data, config) {
    return {
      ...registration,
      state: "issued",
      active: config.api_key === undefined && !hasOAuth(),
      agent_id: data.agent_id,
      trial_credits: data.trial_credits,
      expires_at: data.expires_at,
      policy: "legacy_agent_trial",
      strict_credit_budget: false,
    };
  }

  async function readIssuedRecord(registration) {
    if (!registration || !["pending", "unknown", "issued"].includes(registration.state)) return null;
    let record;
    try {
      record =
        registration.storage === "keyring"
          ? JSON.parse((await entryFor(registration.operation_id))?.getPassword() || "null")
          : read()[SECRET_CONFIG_KEY];
    } catch {
      throw new CliError("TRIAL_STORAGE_FAILED");
    }
    if (!record || record.state === "prepared") return null;
    if (
      record.state !== "issued" ||
      record.operation_id !== registration.operation_id ||
      record.base_url !== registration.base_url ||
      !validTrialData(record.data)
    )
      throw new CliError("TRIAL_STORAGE_FAILED");
    return record;
  }

  async function persistTrialCredential(registration, data) {
    if (!validTrialData(data)) throw new CliError("TRIAL_STORAGE_FAILED");
    return lock(async () => {
      const config = read();
      const current = getTrialRegistration();
      if (
        current?.operation_id !== registration.operation_id ||
        current.base_url !== registration.base_url ||
        current.storage !== registration.storage ||
        !["pending", "unknown"].includes(current.state)
      )
        throw new CliError("TRIAL_STORAGE_FAILED");
      // Save the entire response first: metadata can then be reconstructed after
      // a crash between Keyring success and the config's atomic rename.
      const record = {
        operation_id: current.operation_id,
        base_url: current.base_url,
        state: "issued",
        data: {
          api_key: data.api_key,
          claim_code: data.claim_code,
          agent_id: data.agent_id,
          trial_credits: data.trial_credits,
          expires_at: data.expires_at,
        },
      };
      if (current.storage === "keyring") {
        try {
          const entry = await entryFor(current.operation_id);
          if (!entry) throw new Error("Credential store unavailable");
          const serialized = JSON.stringify(record);
          entry.setPassword(serialized);
          if (entry.getPassword() !== serialized) throw new Error("Credential store verification failed");
        } catch {
          throw new CliError("TRIAL_STORAGE_FAILED");
        }
      }
      const metadata = issuedMetadata(current, data, config);
      write({
        ...config,
        [JOURNAL]: metadata,
        ...(current.storage === "config" ? { [SECRET_CONFIG_KEY]: record } : {}),
      });
      return metadata;
    });
  }

  async function recoverTrialRegistration() {
    return lock(async () => {
      const config = read();
      const current = getTrialRegistration();
      if (!current || !["pending", "unknown"].includes(current.state)) return current;
      const record = await readIssuedRecord(current);
      if (!record) return current;
      const metadata = issuedMetadata(current, record.data, config);
      write({ ...config, [JOURNAL]: metadata });
      return metadata;
    });
  }

  async function exportTrialCredential() {
    // Export can rescue a durable Keyring result even while config finalization
    // remains unavailable. It never contacts the registration endpoint.
    const current = getTrialRegistration();
    const record = await readIssuedRecord(current);
    if (!record) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    const metadata =
      current.state === "issued"
        ? current
        : { ...issuedMetadata(current, record.data, read()), active: false, recovery_pending: true };
    return { registration: metadata, secret: { api_key: record.data.api_key, claim_code: record.data.claim_code } };
  }

  async function loadTrialSecret(registration = getTrialRegistration()) {
    if (registration?.state !== "issued") throw new CliError("AUTH_MISSING_KEY");
    const record = await readIssuedRecord(registration);
    if (!record) throw new CliError("TRIAL_STORAGE_FAILED");
    return { api_key: record.data.api_key, claim_code: record.data.claim_code };
  }

  function createStoredTrialCredentialProvider() {
    const expected = getTrialRegistration();
    return {
      authType: "api_key",
      async getCredential({ resource }) {
        const current = getTrialRegistration();
        if (!expected || current?.operation_id !== expected.operation_id || !hasStoredTrialCredential())
          throw new CliError("TRIAL_STORAGE_FAILED");
        if (normalizeBaseUrl(resource) !== current.base_url)
          throw new CliError("API_ERROR", "Stored trial credential does not match the selected API endpoint");
        if (!Number.isFinite(Date.parse(current.expires_at)) || Date.parse(current.expires_at) <= Date.now())
          throw new CliError("TRIAL_EXPIRED");
        return (await loadTrialSecret(current)).api_key;
      },
    };
  }

  // Caller owns the shared credential lock, like deleteOAuthSession().
  async function removeTrialCredential() {
    const config = read();
    const registration = getTrialRegistration();
    if (!registration || registration.state === "logged_out") return;
    if (["pending", "unknown"].includes(registration.state)) throw new CliError("TRIAL_ISSUANCE_UNKNOWN");
    if (registration.storage === "keyring") {
      try {
        const entry = await entryFor(registration.operation_id);
        if (!entry) throw new Error("Credential store unavailable");
        entry.deletePassword();
      } catch {
        throw new CliError("TRIAL_STORAGE_FAILED");
      }
    }
    delete config[SECRET_CONFIG_KEY];
    write({ ...config, [JOURNAL]: { ...registration, state: "logged_out", active: false } });
  }

  return {
    getTrialRegistration,
    hasStoredTrialCredential,
    beginTrialRegistration,
    recordTrialFailure,
    persistTrialCredential,
    recoverTrialRegistration,
    exportTrialCredential,
    loadTrialSecret,
    createStoredTrialCredentialProvider,
    removeTrialCredential,
  };
}

export const {
  getTrialRegistration,
  hasStoredTrialCredential,
  beginTrialRegistration,
  recordTrialFailure,
  persistTrialCredential,
  recoverTrialRegistration,
  exportTrialCredential,
  loadTrialSecret,
  createStoredTrialCredentialProvider,
  removeTrialCredential,
} = createTrialStorage();
