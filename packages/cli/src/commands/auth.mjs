import { execFile } from "node:child_process";
import { platform } from "node:os";
import { resolveBaseUrl } from "../config/endpoint.mjs";
import { discoverTools } from "../client/api.mjs";
import { bold, cyan, dim, green, red } from "../output/colors.mjs";
import {
  DEFAULT_OAUTH_SCOPES,
  createStoredOAuthCredentialProvider,
  discoverAuthorizationServer,
  pollDeviceToken,
  revokeOAuthToken,
  startDeviceAuthorization,
} from "../auth/oauth.mjs";
import {
  deleteOAuthSession,
  getOAuthSessionMetadata,
  loadOAuthSessionSecret,
  saveOAuthSession,
} from "../auth/storage.mjs";

function openBrowser(url) {
  const command = { darwin: "open", win32: "cmd", linux: "xdg-open" }[platform()] || "xdg-open";
  const args = platform() === "win32" ? ["/c", "start", "", url] : [url];
  execFile(command, args, () => {});
}

export async function runAuth(subcommand, flags) {
  if (subcommand === "login") return authLogin(flags);
  if (subcommand === "status") return authStatus(flags);
  if (subcommand === "logout") return authLogout(flags);
  console.error("  Usage: qveris auth <login|status|logout>");
  process.exitCode = 2;
}

async function authLogin(flags) {
  const { baseUrl } = resolveBaseUrl({ baseUrlFlag: flags.baseUrl });
  const issuer = new URL(baseUrl).origin;
  const metadata = await discoverAuthorizationServer(issuer);
  const scope = flags.scope || DEFAULT_OAUTH_SCOPES;
  const requestedScopes = scope.split(/\s+/).filter(Boolean);
  const unsupported = requestedScopes.filter((item) => !metadata.scopes_supported.includes(item));
  if (unsupported.length) throw new Error(`OAuth scopes are not supported: ${unsupported.join(", ")}`);
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
    openBrowser(authorization.verification_uri_complete || authorization.verification_uri);
  }

  const tokens = await pollDeviceToken(metadata, authorization);
  const session = {
    issuer,
    api_base_url: baseUrl,
    resource: tokens.resource || resource,
    scope: tokens.scope || scope,
    token_endpoint: metadata.token_endpoint,
    revocation_endpoint: metadata.revocation_endpoint,
    expires_at: Date.now() + Math.max(1, Number(tokens.expires_in) || 3600) * 1000,
  };
  await deleteOAuthSession();
  const persisted = await saveOAuthSession(session, {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
  });
  const result = { authenticated: true, issuer, resource: session.resource, scope: session.scope, persisted };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`  ${green("✓")} Device authorization completed.`);
    console.log(
      persisted
        ? `  ${dim("Refresh credentials saved in the operating-system credential store.")}`
        : `  ${red("!")} No operating-system credential store is available; credentials last only for this process.`,
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
  await discoverTools({
    credentialProvider: provider,
    baseUrl: metadata.api_base_url,
    query: "test",
    limit: 1,
    timeoutMs: 10000,
  });
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
  const metadata = getOAuthSessionMetadata();
  const secret = await loadOAuthSessionSecret(metadata);
  let revokeError = null;
  try {
    if (metadata && secret) {
      await revokeOAuthToken(metadata, secret.refresh_token, "refresh_token");
      await revokeOAuthToken(metadata, secret.access_token, "access_token");
    }
  } catch (error) {
    revokeError = error;
  } finally {
    await deleteOAuthSession();
  }
  const result = { authenticated: false, local_credentials_removed: true, revoked: !revokeError };
  if (flags.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`  ${green("✓")} Local OAuth credentials removed.`);
    if (revokeError) console.error(`  ${red("!")} Remote revocation failed; the local session was still cleared.`);
  }
  if (revokeError) process.exitCode = 1;
}
