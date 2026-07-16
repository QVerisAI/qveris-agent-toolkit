import { describe, expect, it } from 'vitest';

import {
  bearerAuthHeaderInput,
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

  it('attaches remoteHeaders to the remote and leaves header-less cards unchanged', () => {
    const withHeaders = buildServerCard(
      { ...INFO, remoteHeaders: [bearerAuthHeaderInput()] },
      'https://mcp.example.com/mcp',
    );
    expect(withHeaders.remotes?.[0].headers).toHaveLength(1);
    expect(withHeaders.remotes?.[0].headers?.[0].name).toBe('Authorization');

    const withoutHeaders = buildServerCard(INFO, 'https://mcp.example.com/mcp');
    expect(withoutHeaders.remotes?.[0]).not.toHaveProperty('headers');
  });

  it('ignores remoteHeaders when no remote URL is given (stdio card)', () => {
    const card = buildServerCard({ ...INFO, remoteHeaders: [bearerAuthHeaderInput()] });
    expect(card.remotes).toBeUndefined();
  });

  it('rejects secret headers carrying literal values instead of {variable} templates', () => {
    const literal = { name: 'Authorization', isSecret: true, value: 'Bearer sk-real-key' };
    expect(() => buildServerCard({ ...INFO, remoteHeaders: [literal] }, 'https://mcp.example.com/mcp')).toThrow(
      /never a literal credential/,
    );
  });

  it('rejects secret headers and secret variables with literal defaults', () => {
    const headerDefault = { name: 'Authorization', isSecret: true, default: 'sk-real-key' };
    expect(() => buildServerCard({ ...INFO, remoteHeaders: [headerDefault] }, 'https://mcp.example.com/mcp')).toThrow(
      /literal default/,
    );

    const variableDefault = {
      name: 'Authorization',
      value: 'Bearer {api_key}',
      variables: { api_key: { isSecret: true, default: 'sk-real-key' } },
    };
    expect(() => buildServerCard({ ...INFO, remoteHeaders: [variableDefault] }, 'https://mcp.example.com/mcp')).toThrow(
      /secret variables must not embed/,
    );
  });
});

describe('bearerAuthHeaderInput', () => {
  it('builds the required+secret Authorization template', () => {
    expect(bearerAuthHeaderInput()).toEqual({
      name: 'Authorization',
      description: 'Bearer authentication for this remote endpoint.',
      isRequired: true,
      isSecret: true,
      value: 'Bearer {api_key}',
      variables: {
        api_key: {
          description: 'Secret credential for this remote endpoint.',
          isRequired: true,
          isSecret: true,
        },
      },
    });
  });

  it('supports a custom variable name and descriptions', () => {
    const header = bearerAuthHeaderInput({
      variableName: 'qveris_api_key',
      description: 'QVeris bearer auth.',
      variableDescription: 'API key from the QVeris console.',
    });
    expect(header.value).toBe('Bearer {qveris_api_key}');
    expect(header.variables?.qveris_api_key?.description).toBe('API key from the QVeris console.');
  });

  it('rejects variable names that are not valid template identifiers', () => {
    expect(() => bearerAuthHeaderInput({ variableName: 'not-valid' })).toThrow(/template variable name/);
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
