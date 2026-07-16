/**
 * MCP Server Card + Catalog (connection-less discovery metadata).
 *
 * Implements the discovery documents from SEP-2127 / SEP-1649 so registries and
 * crawlers can learn what this server is and how to reach it *before* opening a
 * connection:
 *
 * - **Server Card** — served at `GET <streamable-http-url>/server-card` with
 *   media type `application/mcp-server-card+json`. Describes the server's
 *   identity (reverse-DNS name, version, description) and its remote endpoint.
 * - **MCP Catalog** — served at `GET /.well-known/mcp/catalog.json`. A site-wide
 *   index that points at the Server Card(s).
 *
 * The card is advisory (a static manifest that can drift from runtime), so it
 * carries identity/connection metadata only — never tools/resources, which stay
 * subject to the live `tools/list` etc. See docs/discovery.md in
 * modelcontextprotocol/experimental-ext-server-card.
 *
 * @module @qverisai/mcp/server-card
 */

export const SERVER_CARD_SCHEMA_URL = 'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
export const SERVER_CARD_MEDIA_TYPE = 'application/mcp-server-card+json';
export const CATALOG_PATH = '/.well-known/mcp/catalog.json';
export const CATALOG_SPEC_VERSION = 'draft';

/** Source metadata for building the discovery documents (from package.json). */
export interface ServerCardInfo {
  /** Reverse-DNS server name, e.g. `io.github.QVerisAI/mcp`. */
  name: string;
  version: string;
  description: string;
  title?: string;
  websiteUrl?: string;
  repository?: { source: string; url: string; subfolder?: string };
  /** Protocol versions the server negotiates (from the MCP SDK). */
  protocolVersions?: string[];
  /**
   * Header inputs advertised on the card's remote, e.g. a Bearer template
   * built with {@link bearerAuthHeaderInput}. Only used when a remote URL is
   * passed to {@link buildServerCard}; secret inputs must stay templated —
   * {@link buildServerCard} rejects literal secret material.
   */
  remoteHeaders?: ServerCardKeyValueInput[];
}

/**
 * A user-supplied or pre-set input value, used for {@link ServerCardRemote}
 * URL variables and header values (schema `$defs/Input`).
 */
export interface ServerCardInput {
  /** Allowed values for the input. If provided, the user must select one. */
  choices?: string[];
  /** Default value. SHOULD be a valid value for the input. */
  default?: string;
  /** Human-readable explanation of the input. */
  description?: string;
  /** Input format hint. */
  format?: 'boolean' | 'filepath' | 'number' | 'string';
  /** Whether the input must be supplied for the connection to succeed. */
  isRequired?: boolean;
  /** Whether the input is a secret (clients must handle it securely). */
  isSecret?: boolean;
  /** Placeholder shown during configuration. */
  placeholder?: string;
  /** Pre-set value; `{curly_braces}` identifiers substitute from `variables`. */
  value?: string;
}

/**
 * A named {@link ServerCardInput} — used for HTTP headers — whose `value` may
 * reference `{variable}` placeholders (schema `$defs/KeyValueInput`).
 */
export interface ServerCardKeyValueInput extends ServerCardInput {
  name: string;
  /** Variables referenced as `{placeholders}` inside `value`. */
  variables?: Record<string, ServerCardInput>;
}

export interface ServerCardRemote {
  type: 'streamable-http';
  url: string;
  /** HTTP headers required or accepted when connecting to this remote. */
  headers?: ServerCardKeyValueInput[];
  /** Variables referenced as `{placeholders}` in `url`. */
  variables?: Record<string, ServerCardInput>;
  supportedProtocolVersions?: string[];
}

export interface ServerCard {
  $schema: string;
  name: string;
  version: string;
  description: string;
  title?: string;
  websiteUrl?: string;
  repository?: { source: string; url: string; subfolder?: string };
  remotes?: ServerCardRemote[];
}

export interface McpCatalogEntry {
  identifier: string;
  displayName: string;
  mediaType: typeof SERVER_CARD_MEDIA_TYPE;
  url: string;
}

export interface McpCatalog {
  specVersion: typeof CATALOG_SPEC_VERSION;
  entries: McpCatalogEntry[];
}

/** `{variable}` placeholder syntax accepted by the Server Card schema. */
const TEMPLATE_PLACEHOLDER = /\{[a-zA-Z_][a-zA-Z0-9_]*\}/;
const VARIABLE_NAME = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Reject header metadata that would publish secret material in the card.
 *
 * The card is a public, unauthenticated discovery document: a secret may only
 * be *described* (name + required/secret flags), never carried. Secret header
 * values must be templates referencing a `{variable}` — with nothing beyond a
 * short alphabetic scheme prefix (e.g. `Bearer `) around the placeholders, so
 * a literal credential can't ride alongside one — and secret variables must
 * not embed a literal `value` or `default`.
 */
function assertHeadersCarryNoSecrets(headers: ServerCardKeyValueInput[]): void {
  for (const header of headers) {
    if (header.isSecret) {
      if (header.default !== undefined) {
        throw new Error(`Server Card header "${header.name}": secret headers must not declare a literal default.`);
      }
      if (header.value !== undefined) {
        if (!TEMPLATE_PLACEHOLDER.test(header.value)) {
          throw new Error(
            `Server Card header "${header.name}": secret header values must reference a {variable} placeholder, ` +
              `never a literal credential.`,
          );
        }
        // After stripping placeholders, only a single short alphabetic scheme
        // token (e.g. "Bearer", "Basic") may remain: hyphens, digits, and
        // multiple words are how literal credentials ride along a template.
        const residue = header.value.replace(new RegExp(TEMPLATE_PLACEHOLDER, 'g'), ' ').trim();
        if (!/^[A-Za-z]{0,16}$/.test(residue)) {
          throw new Error(
            `Server Card header "${header.name}": secret header values must only contain {variable} placeholders ` +
              `and an optional short alphabetic scheme prefix (e.g. "Bearer {api_key}").`,
          );
        }
      }
    }
    for (const [name, variable] of Object.entries(header.variables ?? {})) {
      // Untyped embedder config can carry null entries; skip them here — the
      // schema validation tests reject them as structurally invalid anyway.
      if (variable && variable.isSecret && (variable.value !== undefined || variable.default !== undefined)) {
        throw new Error(
          `Server Card header "${header.name}" variable "${name}": secret variables must not embed a ` +
            `literal value or default.`,
        );
      }
    }
  }
}

/**
 * Authorization header template for bearer-credential remotes.
 *
 * The credential itself never appears in the card: the header value is the
 * template `Bearer {<variableName>}` and the variable is declared
 * required + secret, so discovery clients prompt for it and store it securely.
 */
export function bearerAuthHeaderInput(
  options: {
    /** Template variable name (default `api_key`). */
    variableName?: string;
    /** Header description shown by configuration UIs. */
    description?: string;
    /** Description of the secret variable itself. */
    variableDescription?: string;
  } = {},
): ServerCardKeyValueInput {
  const variableName = options.variableName ?? 'api_key';
  if (!VARIABLE_NAME.test(variableName)) {
    throw new Error(`Invalid Server Card template variable name: "${variableName}".`);
  }
  return {
    name: 'Authorization',
    description: options.description ?? 'Bearer authentication for this remote endpoint.',
    isRequired: true,
    isSecret: true,
    value: `Bearer {${variableName}}`,
    variables: {
      [variableName]: {
        description: options.variableDescription ?? 'Secret credential for this remote endpoint.',
        isRequired: true,
        isSecret: true,
      },
    },
  };
}

/**
 * Build the Server Card describing this server's identity and remote endpoint.
 *
 * @param info - Static metadata (name/version/description/...). When
 *   `info.remoteHeaders` is set, the headers are attached to the remote after
 *   the no-literal-secrets check.
 * @param remoteUrl - The absolute Streamable HTTP endpoint URL clients connect
 *   to (e.g. `https://mcp.example.com/mcp`).
 */
export function buildServerCard(info: ServerCardInfo, remoteUrl?: string): ServerCard {
  const card: ServerCard = {
    $schema: SERVER_CARD_SCHEMA_URL,
    name: info.name,
    version: info.version,
    description: info.description,
  };
  if (remoteUrl) {
    const remote: ServerCardRemote = { type: 'streamable-http', url: remoteUrl };
    if (info.remoteHeaders && info.remoteHeaders.length > 0) {
      assertHeadersCarryNoSecrets(info.remoteHeaders);
      remote.headers = info.remoteHeaders;
    }
    if (info.protocolVersions && info.protocolVersions.length > 0) {
      remote.supportedProtocolVersions = info.protocolVersions;
    }
    card.remotes = [remote];
  }
  if (info.title) card.title = info.title;
  if (info.websiteUrl) card.websiteUrl = info.websiteUrl;
  if (info.repository) card.repository = info.repository;
  return card;
}

/** Derive the publisher domain (AI Catalog URN anchor) from the website URL. */
function publisherDomain(info: ServerCardInfo): string {
  if (info.websiteUrl) {
    try {
      return new URL(info.websiteUrl).host;
    } catch {
      /* fall through */
    }
  }
  return 'localhost';
}

/**
 * Build the site-wide MCP Catalog pointing at this server's Server Card.
 *
 * @param info - Static metadata.
 * @param cardUrl - Absolute URL where the Server Card is served.
 */
export function buildCatalog(info: ServerCardInfo, cardUrl: string): McpCatalog {
  // urn:air:{publisher-domain}:{name-suffix} (the segment after `/` in the name).
  const nameSuffix = info.name.split('/').pop() || info.name;
  return {
    specVersion: CATALOG_SPEC_VERSION,
    entries: [
      {
        identifier: `urn:air:${publisherDomain(info)}:${nameSuffix}`,
        displayName: info.title || info.name,
        mediaType: SERVER_CARD_MEDIA_TYPE,
        url: cardUrl,
      },
    ],
  };
}
