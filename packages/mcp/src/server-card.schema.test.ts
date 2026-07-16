/**
 * Real JSON Schema validation of generated Server Cards against the vendored
 * upstream schema (pinned commit — see schemas/README.md).
 *
 * These tests are the CI signal for "generated card is structurally invalid".
 * Availability of the public `$schema` URL is probed separately and
 * non-blockingly by scripts/check-server-card-schema-url.mjs, so the two
 * failure modes never mix.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { describe, expect, it } from 'vitest';

import { bearerAuthHeaderInput, buildServerCard, type ServerCardInfo } from './server-card.js';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '../schemas/server-card.schema.json');
const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf-8')) as Record<string, unknown>;

// The schema file only carries $defs; cards validate against $defs/ServerCard.
const ajv = new Ajv2020.default({ allErrors: true, strict: false });
const validate = ajv.compile({ ...schema, $ref: '#/$defs/ServerCard' });

const INFO: ServerCardInfo = {
  name: 'io.github.QVerisAI/mcp',
  version: '1.2.3',
  description: 'QVeris MCP server.',
  title: 'QVeris',
  websiteUrl: 'https://qveris.ai',
  repository: { source: 'github', url: 'https://github.com/QVerisAI/qveris-agent-toolkit', subfolder: 'packages/mcp' },
  protocolVersions: ['2025-06-18'],
};

function expectValid(card: unknown) {
  const ok = validate(card);
  expect(ok, JSON.stringify(validate.errors, null, 2)).toBe(true);
}

describe('generated Server Cards validate against the pinned upstream schema', () => {
  it('minimal card (stdio mode, no remote)', () => {
    expectValid(buildServerCard({ name: 'example.org/x', version: '1.0.0', description: 'min' }));
  });

  it('full card with a remote', () => {
    expectValid(buildServerCard(INFO, 'https://mcp.qveris.ai/mcp'));
  });

  it('hosted card with a Bearer Authorization header template', () => {
    const card = buildServerCard(
      { ...INFO, remoteHeaders: [bearerAuthHeaderInput({ variableDescription: 'QVeris API key.' })] },
      'https://mcp.qveris.ai/mcp',
    );
    expectValid(card);

    const header = card.remotes?.[0].headers?.[0];
    expect(header?.name).toBe('Authorization');
    expect(header?.isRequired).toBe(true);
    expect(header?.isSecret).toBe(true);
    expect(header?.value).toBe('Bearer {api_key}');
    expect(header?.variables?.api_key).toMatchObject({ isRequired: true, isSecret: true });
  });

  it('the serialized card never contains literal credential material', () => {
    const card = buildServerCard({ ...INFO, remoteHeaders: [bearerAuthHeaderInput()] }, 'https://mcp.qveris.ai/mcp');
    const serialized = JSON.stringify(card);
    // Any header value carrying "Bearer" must be the {variable} template — no literal token.
    expect(serialized).not.toMatch(/"value":"Bearer (?!\{)/);
    expect(serialized).not.toMatch(/sk-[A-Za-z0-9]/);
  });

  it('the card references only the endpoint it was built for', () => {
    const card = buildServerCard(INFO, 'https://mcp.qveris.cn/mcp');
    const urls = (card.remotes ?? []).map((r) => r.url);
    expect(urls).toEqual(['https://mcp.qveris.cn/mcp']);
    expect(JSON.stringify(card.remotes)).not.toContain('qveris.ai');
  });
});

describe('the validator actually bites (negative controls)', () => {
  it('rejects a name without a namespace slash', () => {
    const card = buildServerCard(INFO, 'https://mcp.qveris.ai/mcp');
    expect(validate({ ...card, name: 'no-slash' })).toBe(false);
  });

  it('rejects a mutable raw/main $schema URL', () => {
    const card = buildServerCard(INFO);
    const mutable = {
      ...card,
      $schema: 'https://raw.githubusercontent.com/modelcontextprotocol/experimental-ext-server-card/main/schema.json',
    };
    expect(validate(mutable)).toBe(false);
  });

  it('rejects a missing $schema', () => {
    const { $schema: _dropped, ...cardWithout } = buildServerCard(INFO);
    expect(validate(cardWithout)).toBe(false);
  });

  it('rejects a remote with an invalid transport type', () => {
    const card = buildServerCard(INFO, 'https://mcp.qveris.ai/mcp');
    const broken = { ...card, remotes: [{ ...card.remotes![0], type: 'websocket' }] };
    expect(validate(broken)).toBe(false);
  });
});
