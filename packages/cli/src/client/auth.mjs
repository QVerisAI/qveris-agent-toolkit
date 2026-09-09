import { resolve } from "../config/resolve.mjs";
import { CliError } from "../errors/handler.mjs";
import { createStoredOAuthCredentialProvider } from "../auth/oauth.mjs";
import { authorizationContextForApiKey, authorizationContextForOAuth } from "../auth/context.mjs";
import { getOAuthSessionMetadata, hasOAuthSession, loadOAuthSessionSecret } from "../auth/storage.mjs";

const PLACEHOLDER_PATTERNS = [/^your[_-]?(qveris)?[_-]?api[_-]?key/i, /^sk-1_xxx/, /^sk-1_$/, /^YOUR_/];

export function resolveApiKey(flagValue) {
  const { value } = resolve("api_key", flagValue);

  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) {
    if (hasOAuthSession()) return undefined;
    throw new CliError("AUTH_MISSING_KEY");
  }
  if (typeof value !== "string") {
    throw new CliError("AUTH_MISSING_KEY", "Configured API key must be a string. Run qveris login to replace it.");
  }

  const trimmed = value.trim();
  if (isPlaceholderApiKey(trimmed)) {
    throw new CliError("AUTH_MISSING_KEY", "API key appears to be a placeholder. Set a real key.");
  }

  return trimmed;
}

export async function resolveAuthorizationContextId({ apiKey } = {}) {
  if (apiKey !== undefined) {
    const context = authorizationContextForApiKey(apiKey);
    if (context) return context;
    throw new CliError("AUTH_MISSING_KEY");
  }

  const metadata = getOAuthSessionMetadata();
  const secret = await loadOAuthSessionSecret(metadata);
  const context = authorizationContextForOAuth(metadata, secret);
  if (!context) {
    throw new CliError("AUTH_OAUTH_FAILED", "OAuth session cannot be bound to CLI discovery state; log in again.");
  }
  return context;
}

export function createAuthorizationContextCredentialProvider({ apiKey, authorizationContext }) {
  if (apiKey !== undefined) return undefined;
  const provider = createStoredOAuthCredentialProvider();

  async function assertCurrentContext() {
    const current = await resolveAuthorizationContextId({ apiKey: undefined });
    if (current !== authorizationContext) {
      throw new CliError(
        "AUTH_OAUTH_FAILED",
        "OAuth authorization context changed before the request was sent; retry discovery with the current login.",
      );
    }
  }

  return {
    authType: provider.authType,
    async getCredential(context) {
      const credential = await provider.getCredential(context);
      await assertCurrentContext();
      return credential;
    },
    async refreshCredential() {
      const credential = await provider.refreshCredential();
      await assertCurrentContext();
      return credential;
    },
  };
}

export function isPlaceholderApiKey(value) {
  if (typeof value !== "string") return true;
  const trimmed = value.trim();
  return PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed));
}

export function createApiKeyCredentialProvider(apiKey) {
  const value = typeof apiKey === "string" ? apiKey.trim() : "";
  if (!value || /[\r\n]/.test(value)) {
    throw new CliError("AUTH_MISSING_KEY");
  }
  return {
    async getCredential() {
      return value;
    },
  };
}

export function resolveCredentialProvider({ apiKey, credentialProvider } = {}) {
  if (apiKey !== undefined && credentialProvider !== undefined) {
    throw new CliError("API_ERROR", "Configure either apiKey or credentialProvider, not both");
  }
  if (credentialProvider !== undefined) {
    if (typeof credentialProvider?.getCredential !== "function") {
      throw new CliError("API_ERROR", "credentialProvider must implement getCredential()");
    }
    return credentialProvider;
  }
  if (apiKey === undefined && hasOAuthSession()) {
    return createStoredOAuthCredentialProvider();
  }
  return createApiKeyCredentialProvider(apiKey);
}

export async function getCredential(provider, context) {
  let credential;
  try {
    credential = await provider.getCredential(context);
  } catch (error) {
    if (error instanceof CliError) throw error;
    throw new CliError("API_ERROR", "Credential provider failed to provide a credential");
  }
  if (typeof credential !== "string" || !credential.trim() || /[\r\n]/.test(credential)) {
    throw new CliError("API_ERROR", "Credential provider returned an invalid credential");
  }
  return credential.trim();
}
