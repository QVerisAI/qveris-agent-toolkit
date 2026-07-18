import { resolveBaseUrl } from "../config/endpoint.mjs";
import { discoverTools } from "../client/api.mjs";
import { CliError } from "../errors/handler.mjs";
import { bold, cyan, dim, green, red } from "../output/colors.mjs";
import { openUrl } from "../utils/open-url.mjs";
import {
  DEFAULT_OAUTH_SCOPES,
  createStoredOAuthCredentialProvider,
  discoverAuthorizationServer,
  pollDeviceToken,
  revokeOAuthSession,
  startDeviceAuthorization,
  validateOAuthScopes,
  validateOAuthTokenBinding,
} from "../auth/oauth.mjs";
import {
  deleteOAuthSession,
  getOAuthSessionMetadata,
  loadOAuthSessionSecret,
  saveOAuthSession,
  withOAuthRefreshLock,
} from "../auth/storage.mjs";

export async function runAuth(subcommand, flags) {
  if (subcommand === "login") return authLogin(flags);
  if (subcommand === "status") return authStatus(flags);
  if (subcommand === "logout") return authLogout(flags);
  console.error("  Usage: qveris auth <login|status|logout>");
  process.exitCode = 2;
}

async function authLogin(flags) {
  const previousMetadata = getOAuthSessionMetadata();
  const previousSecret = await loadOAuthSessionSecret(previousMetadata);
  const { baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  const issuer = new URL(baseUrl).origin;
  const metadata = await discoverAuthorizationServer(issuer);
  const scope = validateOAuthScopes(metadata, flags.scope || DEFAULT_OAUTH_SCOPES).join(" ");
  const resource = flags.resource || `${issuer}/tools`;
  const authorization = await startDeviceAuthorization(metadata, { scope, resource });

  if (!flags.json) {
    console.log(`\n  ${bold("Authorize QVeris CLI")}`);
    console.log(`  Open: ${cyan(authorization.verification_uri)}`);
    console.log(`  Code: ${bold(authorization.user_code)}`);
    console.log(`  ${dim("Waiting for approval...")}\n`);
  } else {
    console.error(
      JSON.stringify({
        status: "authorization_pending",
        verification_uri: authorization.verification_uri,
        user_code: authorization.user_code,
        expires_in: authorization.expires_in,
      }),
    );
  }
  if (!flags.noBrowser) {
    openUrl(authorization.verification_uri_complete || authorization.verification_uri);
  }

  const tokens = await pollDeviceToken(metadata, authorization);
  const newSecret = {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  };
  let persisted;
  let session;
  try {
    const binding = validateOAuthTokenBinding(tokens, { resource, scope });
    session = {
      issuer,
      api_base_url: baseUrl,
      ...binding,
      token_endpoint: metadata.token_endpoint,
      revocation_endpoint: metadata.revocation_endpoint,
      expires_at: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000,
    };
    persisted = await withOAuthRefreshLock(async () => {
      const currentMetadata = getOAuthSessionMetadata({ fresh: true });
      const currentSecret = await loadOAuthSessionSecret(currentMetadata, { fresh: true });
      const snapshotUnchanged =
        previousMetadata === null
          ? currentMetadata === null
          : currentMetadata?.issuer === previousMetadata.issuer &&
            currentMetadata?.api_base_url === previousMetadata.api_base_url &&
            currentSecret?.access_token === previousSecret?.access_token &&
            currentSecret?.refresh_token === previousSecret?.refresh_token;
      if (!snapshotUnchanged) {
        throw new CliError(
          "API_ERROR",
          "OAuth session changed while device authorization was in progress; retry login",
        );
      }
      if (currentMetadata && currentSecret) await revokeOAuthSession(currentMetadata, currentSecret);
      await deleteOAuthSession();
      return saveOAuthSession(session, newSecret, {
        allowUnencryptedStorage: flags.allowUnencryptedStorage,
      });
    });
  } catch (error) {
    try {
      await revokeOAuthSession(metadata, newSecret);
    } catch {
      // Preserve the local-storage error as the actionable failure.
    }
    throw error;
  }
  const storage = getOAuthSessionMetadata()?.storage || "session";
  const result = {
    authenticated: true,
    issuer,
    resource: session.resource,
    scope: session.scope,
    persisted,
    storage,
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`  ${green("✓")} Device authorization completed.`);
    console.log(
      storage === "keyring"
        ? `  ${dim("Refresh credentials saved in the operating-system credential store.")}`
        : storage === "config"
          ? `  ${red("!")} Refresh credentials saved unencrypted in the user-only config file.`
          : `  ${red("!")} No credential store is available; rerun with --allow-unencrypted-storage to persist this session.`,
    );
  }
}

async function authStatus(flags) {
  const metadata = getOAuthSessionMetadata();
  const secret = await loadOAuthSessionSecret(metadata);
  if (!metadata || !secret) {
    const result = { authenticated: false, type: "oauth" };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else console.log(`  Not authenticated with OAuth. Run ${cyan("qveris auth login")}.`);
    process.exitCode = 1;
    return;
  }
  const provider = createStoredOAuthCredentialProvider();
  try {
    await discoverTools({
      credentialProvider: provider,
      baseUrl: metadata.api_base_url,
      query: "test",
      limit: 1,
      timeoutMs: 10000,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "OAuth session validation failed";
    const result = { authenticated: false, type: "oauth", error: message };
    if (flags.json) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`  ${red("!")} OAuth session is invalid or expired.`);
      console.log(`  Error: ${message}`);
      console.log(`  Run ${cyan("qveris auth login")} to log in again.`);
    }
    process.exitCode = 1;
    return;
  }
  const result = {
    authenticated: true,
    type: "oauth",
    issuer: metadata.issuer,
    resource: metadata.resource,
    scope: metadata.scope,
    storage: metadata.storage,
  };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`  ${green("✓")} Authenticated with OAuth Device Flow`);
    console.log(`  Issuer:   ${metadata.issuer}`);
    console.log(`  Resource: ${metadata.resource}`);
    console.log(`  Storage:  ${metadata.storage}`);
  }
}

async function authLogout(flags) {
  let metadata = null;
  let secret = null;
  let revokeError = null;
  let localError = null;
  let lockAcquired = false;
  try {
    await withOAuthRefreshLock(async () => {
      lockAcquired = true;
      metadata = getOAuthSessionMetadata({ fresh: true });
      secret = await loadOAuthSessionSecret(metadata, { fresh: true });
      try {
        if (metadata && secret) await revokeOAuthSession(metadata, secret);
      } catch (error) {
        revokeError = error;
      }
      try {
        await deleteOAuthSession();
      } catch (error) {
        localError = error;
      }
    });
  } catch (error) {
    localError ||= error;
  }
  const remoteRevoked = lockAcquired && (!metadata || Boolean(secret && !revokeError));
  const result = { authenticated: false, local_credentials_removed: !localError, revoked: remoteRevoked };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    if (localError) console.error(`  ${red("!")} Local OAuth credentials could not be completely removed.`);
    else console.log(`  ${green("✓")} Local OAuth credentials removed.`);
    if (revokeError) {
      console.error(
        localError
          ? `  ${red("!")} Remote revocation also failed; retry logout when the credential store is available.`
          : `  ${red("!")} Remote revocation failed; the local session was still cleared.`,
      );
    } else if (metadata && !secret) {
      console.error(
        `  ${red("!")} Remote revocation could not be attempted because the stored credential is unavailable.`,
      );
    }
  }
  if (!remoteRevoked || localError) process.exitCode = 1;
}
