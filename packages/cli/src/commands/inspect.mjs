import {
  createAuthorizationContextCredentialProvider,
  resolveAuthorizationContextId,
  resolveDiscoveryAccess,
} from "../client/auth.mjs";
import { inspectToolsByIds, resolveApiBaseUrl } from "../client/api.mjs";
import {
  resolveToolId,
  getSessionDiscoveryId,
  readSessionForContext,
  readSession,
  writeSession,
} from "../session/session.mjs";
import { authorizationContextForPublicDiscovery } from "../auth/context.mjs";
import { formatInspectResult } from "../output/formatter.mjs";
import { outputJson } from "../output/json.mjs";
import { createSpinner } from "../output/spinner.mjs";
import { CliError } from "../errors/handler.mjs";

export async function runInspect(idsOrIndexes, flags) {
  const access = resolveDiscoveryAccess({
    publicReadOnly: flags.publicReadOnly,
    apiKey: flags.apiKey,
    operation: "inspect",
  });
  const { apiKey, publicReadOnly } = access;
  const timeoutMs = (parseInt(flags.timeout, 10) || 30) * 1000;
  const { baseUrl } = resolveApiBaseUrl({
    baseUrlFlag: flags.baseUrl,
    preferOAuth: !publicReadOnly && apiKey === undefined,
  });
  const numericIndex = idsOrIndexes.some((value) => /^\d+$/.test(value));
  const usesSessionShortcut = numericIndex || !flags.discoveryId;
  let session = null;
  let credentialProvider;
  let authorizationContext;
  let upgrading = false;
  if (usesSessionShortcut) {
    authorizationContext = access.authorizationContext ?? (await resolveAuthorizationContextId({ apiKey }));
    credentialProvider = publicReadOnly
      ? undefined
      : createAuthorizationContextCredentialProvider({ apiKey, authorizationContext });
    const resolvedSession = readSessionForContext({ baseUrl, authorizationContext });
    if (resolvedSession.status === "context_mismatch") {
      const prior = readSession();
      if (
        !publicReadOnly &&
        prior?.baseUrl === baseUrl &&
        prior.authorizationContext === authorizationContextForPublicDiscovery()
      ) {
        session = prior;
        upgrading = true;
      } else {
        throw new CliError(
          "SESSION_EXPIRED",
          "Stored discovery belongs to another API endpoint or authorization context. Run 'qveris discover' again.",
        );
      }
    }
    if (!upgrading) session = resolvedSession.session;
  }

  const toolIds = [];
  let discoveryId = flags.discoveryId || null;

  for (const raw of idsOrIndexes) {
    const resolved = resolveToolId(raw, { session });
    if (/^\d+$/.test(raw) && !resolved.fromSession) {
      throw new CliError("SESSION_EXPIRED", "No matching discovery index. Run 'qveris discover' first.");
    }
    toolIds.push(resolved.toolId);
    if (resolved.fromSession && resolved.discoveryId && !discoveryId) {
      discoveryId = resolved.discoveryId;
    }
  }

  if (!discoveryId) discoveryId = getSessionDiscoveryId({ session });
  if (upgrading || session?.upgradedFromPublic) discoveryId = null;

  const spinner = flags.json ? { stop() {} } : createSpinner("Inspecting tools...");

  try {
    const result = await inspectToolsByIds({
      apiKey,
      publicReadOnly,
      credentialProvider,
      baseUrl,
      toolIds,
      discoveryId,
      timeoutMs,
    });

    spinner.stop();

    if (upgrading || session?.upgradedFromPublic) {
      if (!result.search_id || result.search_id.startsWith("pub_")) throw new CliError("AUTH_PUBLIC_CONTEXT");
      const inspected = new Map(
        (result.results ?? []).filter((tool) => toolIds.includes(tool.tool_id)).map((tool) => [tool.tool_id, tool]),
      );
      writeSession({
        baseUrl,
        authorizationContext,
        discoveryId: result.search_id,
        upgradedFromPublic: true,
        query: session.query,
        // Preserve the original position-to-tool mapping. A subset or reordered
        // Inspect response must never renumber the user's public selections.
        results: session.results.map((selection) => {
          const current = inspected.get(selection.tool_id);
          if (!toolIds.includes(selection.tool_id))
            return { ...selection, authenticated: !upgrading && selection.authenticated === true };
          return {
            ...selection,
            authenticated: Boolean(current),
            discoveryId: current ? result.search_id : null,
            ...(current?.name !== undefined && { name: current.name }),
          };
        }),
      });
    }

    if (flags.json) {
      outputJson(result);
    } else {
      console.log(formatInspectResult(result));
    }
  } catch (err) {
    spinner.stop();
    throw err;
  }
}
