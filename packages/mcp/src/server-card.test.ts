import { describe, expect, it } from 'vitest';

import {
  buildCatalog,
  buildServerCard,
  CATALOG_SPEC_VERSION,
  SERVER_CARD_MEDIA_TYPE,
  SERVER_CARD_SCHEMA_URL,
  type ServerCardInfo,
} from './server-card.js';

const INFO: ServerCardInfo = {
  name: 'io.github.QVerisAI/mcp',
  version: '1.2.3',
  description: 'QVeris MCP server.',
  title: 'QVeris',
  websiteUrl: 'https://qveris.ai',
  repository: { source: 'github', url: 'https://github.com/QVerisAI/qveris-agent-toolkit', subfolder: 'packages/mcp' },
  protocolVersions: ['2025-06-18', '2025-11-25'],
};

// The reverse-DNS name pattern from the Server Card schema.
const NAME_PATTERN = /^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/;

describe('buildServerCard', () => {
  it('produces a schema-valid card with the required fields and remote', () => {
    const card = buildServerCard(INFO, 'https://mcp.example.com/mcp');

    expect(card.$schema).toBe(SERVER_CARD_SCHEMA_URL);
    expect(card.name).toBe('io.github.QVerisAI/mcp');
    expect(card.name).toMatch(NAME_PATTERN);
    expect(card.version).toBe('1.2.3');
    expect(card.description).toBe('QVeris MCP server.');
    expect(card.title).toBe('QVeris');
    expect(card.websiteUrl).toBe('https://qveris.ai');
    expect(card.repository).toEqual(INFO.repository);
    expect(card.remotes).toEqual([
      {
        type: 'streamable-http',
        url: 'https://mcp.example.com/mcp',
        supportedProtocolVersions: ['2025-06-18', '2025-11-25'],
      },
    ]);
  });

  it('omits optional fields and the protocol list when absent', () => {
    const card = buildServerCard(
      { name: 'example.org/x', version: '1.0.0', description: 'min' },
      'http://127.0.0.1:3000/mcp',
    );
    expect(card.title).toBeUndefined();
    expect(card.websiteUrl).toBeUndefined();
    expect(card.repository).toBeUndefined();
    expect(card.remotes?.[0]).toEqual({ type: 'streamable-http', url: 'http://127.0.0.1:3000/mcp' });
    expect(card.remotes?.[0]).not.toHaveProperty('supportedProtocolVersions');
  });
});

describe('buildCatalog', () => {
  it('anchors the URN on the publisher domain and points at the card URL', () => {
    const catalog = buildCatalog(INFO, 'https://mcp.example.com/mcp/server-card');

    expect(catalog.specVersion).toBe(CATALOG_SPEC_VERSION);
    expect(catalog.entries).toEqual([
      {
        identifier: 'urn:air:qveris.ai:mcp',
        displayName: 'QVeris',
        mediaType: SERVER_CARD_MEDIA_TYPE,
        url: 'https://mcp.example.com/mcp/server-card',
      },
    ]);
  });

  it('falls back to localhost as the publisher when no website URL is set', () => {
    const catalog = buildCatalog(
      { name: 'example.org/weather', version: '1.0.0', description: 'x' },
      'http://127.0.0.1:3000/mcp/server-card',
    );
    expect(catalog.entries[0].identifier).toBe('urn:air:localhost:weather');
    expect(catalog.entries[0].displayName).toBe('example.org/weather');
  });
});
