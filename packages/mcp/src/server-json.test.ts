import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface RegistryInput {
  name?: string;
  description?: string;
  isRequired?: boolean;
  isSecret?: boolean;
}

interface RegistryRemote {
  type?: string;
  url?: string;
  headers?: RegistryInput[];
}

interface RegistryPackage {
  identifier?: string;
  version?: string;
  transport?: { type?: string };
}

interface RegistryManifest {
  $schema?: string;
  name?: string;
  title?: string;
  description?: string;
  version?: string;
  remotes?: RegistryRemote[];
  packages?: RegistryPackage[];
}

interface PackageManifest {
  name?: string;
  mcpName?: string;
  version?: string;
}

function loadRegistryManifest(): RegistryManifest {
  const path = join(process.cwd(), 'server.json');
  return JSON.parse(readFileSync(path, 'utf8')) as RegistryManifest;
}

function loadPackageManifest(): PackageManifest {
  const path = join(process.cwd(), 'package.json');
  return JSON.parse(readFileSync(path, 'utf8')) as PackageManifest;
}

describe('MCP Registry manifest', () => {
  it('advertises both Hosted Streamable HTTP and local stdio transports', () => {
    const manifest = loadRegistryManifest();
    const hosted = manifest.remotes?.find((remote) => remote.type === 'streamable-http');
    const local = manifest.packages?.find((entry) => entry.identifier === '@qverisai/mcp');

    expect(manifest.title).toBe('QVeris');
    expect(manifest.description).toContain('Discover, inspect, quote, and call');
    expect(hosted?.url).toBe('https://mcp.qveris.ai/mcp');
    expect(local?.transport?.type).toBe('stdio');
    expect(local?.version).toBe(manifest.version);
  });

  it('declares the Hosted API key as a required secret Authorization header', () => {
    const manifest = loadRegistryManifest();
    const authorization = manifest.remotes?.[0]?.headers?.find((header) => header.name === 'Authorization');

    expect(authorization).toEqual({
      name: 'Authorization',
      description: 'Bearer QVeris API key (format: Bearer YOUR_QVERIS_API_KEY)',
      isRequired: true,
      isSecret: true,
    });
  });

  it('keeps the registry identity and schema aligned with the published package', () => {
    const manifest = loadRegistryManifest();
    const packageManifest = loadPackageManifest();
    const local = manifest.packages?.find((entry) => entry.identifier === packageManifest.name);

    expect(manifest.$schema).toBe('https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json');
    expect(manifest.name).toBe(packageManifest.mcpName);
    expect(manifest.version).toBe(packageManifest.version);
    expect(local?.version).toBe(packageManifest.version);
  });
});
