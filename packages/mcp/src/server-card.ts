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

export const SERVER_CARD_SCHEMA_URL =
  'https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json';
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
}

export interface ServerCardRemote {
  type: 'streamable-http';
  url: string;
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

/**
 * Build the Server Card describing this server's identity and remote endpoint.
 *
 * @param info - Static metadata (name/version/description/...).
 * @param remoteUrl - The absolute Streamable HTTP endpoint URL clients connect
 *   to (e.g. `https://mcp.example.com/mcp`).
 */
export function buildServerCard(info: ServerCardInfo, remoteUrl: string): ServerCard {
  const remote: ServerCardRemote = { type: 'streamable-http', url: remoteUrl };
  if (info.protocolVersions && info.protocolVersions.length > 0) {
    remote.supportedProtocolVersions = info.protocolVersions;
  }

  const card: ServerCard = {
    $schema: SERVER_CARD_SCHEMA_URL,
    name: info.name,
    version: info.version,
    description: info.description,
    remotes: [remote],
  };
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
