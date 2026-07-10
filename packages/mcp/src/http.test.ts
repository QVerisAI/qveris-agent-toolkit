import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, describe, expect, it } from 'vitest';

import { createQverisServer } from './index.js';
import { resolveTransportConfig, startHttpServer, type RunningHttpServer } from './http.js';

describe('resolveTransportConfig', () => {
  it('defaults to stdio with no flags or env', () => {
    const config = resolveTransportConfig({}, []);
    expect(config.mode).toBe('stdio');
  });

  it('selects http via --http flag', () => {
    expect(resolveTransportConfig({}, ['--http']).mode).toBe('http');
  });

  it('selects http via QVERIS_MCP_TRANSPORT=http', () => {
    expect(resolveTransportConfig({ QVERIS_MCP_TRANSPORT: 'http' }, []).mode).toBe('http');
  });

  it('infers http when a port is set, and parses it', () => {
    const fromEnv = resolveTransportConfig({ QVERIS_MCP_HTTP_PORT: '8080' }, []);
    expect(fromEnv.mode).toBe('http');
    expect(fromEnv.port).toBe(8080);

    const fromFlag = resolveTransportConfig({}, ['--port', '9090']);
    expect(fromFlag.mode).toBe('http');
    expect(fromFlag.port).toBe(9090);
  });

  it('lets QVERIS_MCP_TRANSPORT=stdio win over an http port', () => {
    const config = resolveTransportConfig({ QVERIS_MCP_TRANSPORT: 'stdio', QVERIS_MCP_HTTP_PORT: '8080' }, []);
    expect(config.mode).toBe('stdio');
  });

  it('uses sensible HTTP defaults', () => {
    const config = resolveTransportConfig({}, ['--http']);
    expect(config.host).toBe('127.0.0.1');
    expect(config.port).toBe(3000);
    expect(config.path).toBe('/mcp');
    expect(config.enableDnsRebindingProtection).toBe(true);
    expect(config.enableJsonResponse).toBe(false);
    expect(config.authToken).toBeUndefined();
    expect(config.allowUnauthenticated).toBe(false);
    expect(config.maxBodyBytes).toBe(4 * 1024 * 1024);
    expect(config.sessionTimeoutMs).toBe(5 * 60 * 1000);
  });

  it('falls back to the default port for an out-of-range, empty, or valueless port', () => {
    expect(resolveTransportConfig({ QVERIS_MCP_HTTP_PORT: '99999' }, []).port).toBe(3000);
    expect(resolveTransportConfig({}, ['--port', '-1']).port).toBe(3000);
    expect(resolveTransportConfig({ QVERIS_MCP_HTTP_PORT: '' }, []).port).toBe(3000);
    // A bare `--http --port` (no value) must not become an ephemeral port 0.
    expect(resolveTransportConfig({}, ['--http', '--port']).port).toBe(3000);
    // But an explicit 0 (ephemeral bind) is still honored.
    expect(resolveTransportConfig({ QVERIS_MCP_HTTP_PORT: '0' }, []).port).toBe(0);
  });

  it('reads the inbound auth token and body/timeout overrides', () => {
    const config = resolveTransportConfig(
      {
        QVERIS_MCP_TRANSPORT: 'http',
        QVERIS_MCP_HTTP_AUTH_TOKEN: '  secret-token  ',
        QVERIS_MCP_MAX_BODY_BYTES: '1024',
        QVERIS_MCP_SESSION_TIMEOUT_MS: '1000',
      },
      [],
    );
    expect(config.authToken).toBe('secret-token');
    expect(config.maxBodyBytes).toBe(1024);
    expect(config.sessionTimeoutMs).toBe(1000);
  });

  it('parses host/path/allow-lists and boolean toggles from env', () => {
    const config = resolveTransportConfig(
      {
        QVERIS_MCP_TRANSPORT: 'http',
        QVERIS_MCP_HTTP_HOST: '0.0.0.0',
        QVERIS_MCP_HTTP_PATH: '/rpc',
        QVERIS_MCP_ALLOWED_HOSTS: 'a.example, b.example',
        QVERIS_MCP_ALLOWED_ORIGINS: 'https://a.example',
        QVERIS_MCP_DNS_REBINDING_PROTECTION: 'false',
        QVERIS_MCP_HTTP_JSON: 'true',
      },
      [],
    );
    expect(config.host).toBe('0.0.0.0');
    expect(config.path).toBe('/rpc');
    expect(config.allowedHosts).toEqual(['a.example', 'b.example']);
    expect(config.allowedOrigins).toEqual(['https://a.example']);
    expect(config.enableDnsRebindingProtection).toBe(false);
    expect(config.enableJsonResponse).toBe(true);
  });
});

describe('startHttpServer (end-to-end over Streamable HTTP)', () => {
  let running: RunningHttpServer | undefined;

  afterEach(async () => {
    await running?.close();
    running = undefined;
  });

  const CARD_INFO = {
    name: 'io.github.QVerisAI/mcp',
    version: '9.9.9',
    description: 'QVeris MCP server.',
    title: 'QVeris',
    websiteUrl: 'https://qveris.ai',
    protocolVersions: ['2025-11-25'],
  };

  async function startServer(extraEnv: Record<string, string> = {}, cardInfo?: typeof CARD_INFO): Promise<void> {
    const config = resolveTransportConfig({ QVERIS_MCP_TRANSPORT: 'http', QVERIS_MCP_HTTP_PORT: '0', ...extraEnv }, []);
    // Server has no QVERIS_API_KEY, so tool listing works but calls return an
    // actionable error — exactly the credential-less path we want to exercise.
    running = await startHttpServer(config, (sessionId) => createQverisServer(undefined, sessionId), cardInfo);
  }

  async function connectClient(bearer?: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
    if (!running) await startServer();
    const url = new URL(`http://127.0.0.1:${running!.port}/mcp`);
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: bearer ? { headers: { Authorization: `Bearer ${bearer}` } } : undefined,
    });
    const client = new Client({ name: 'test-client', version: '0.0.0' });
    await client.connect(transport);
    return { client, transport };
  }

  it('completes the initialize handshake and assigns a session id', async () => {
    const { client, transport } = await connectClient();
    expect(transport.sessionId).toBeTruthy();
    await client.close();
  });

  it('lists the Qveris MCP tools over HTTP', async () => {
    const { client } = await connectClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['discover', 'inspect', 'call', 'usage_history', 'credits_ledger']));
    await client.close();
  });

  it('routes a tool call and returns the no-credentials error over HTTP', async () => {
    const { client } = await connectClient();
    const result = await client.callTool({
      name: 'discover',
      arguments: { query: 'weather forecast API' },
    });
    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0].text;
    expect(text).toContain('QVERIS_API_KEY');
    await client.close();
  });

  it('rejects a POST without a session id that is not initialize', async () => {
    await connectClient();
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toMatch(/initialize/);
  });

  it('answers the health check', async () => {
    await connectClient();
    const res = await fetch(`http://127.0.0.1:${running!.port}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', transport: 'streamable-http' });
  });

  it('enforces the bearer token when one is configured', async () => {
    await startServer({ QVERIS_MCP_HTTP_AUTH_TOKEN: 'secret-token' });

    // No credentials -> 401.
    const unauth = await fetch(`http://127.0.0.1:${running!.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('www-authenticate')).toBe('Bearer');
    await unauth.text(); // drain so the socket doesn't linger

    // Correct token -> handshake succeeds and tools list.
    const { client } = await connectClient('secret-token');
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.close();

    // Health check stays unauthenticated.
    const health = await fetch(`http://127.0.0.1:${running!.port}/health`);
    expect(health.status).toBe(200);
    await health.text();
  });

  it('returns 413 for an oversized request body', async () => {
    await startServer({ QVERIS_MCP_MAX_BODY_BYTES: '512' });
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { blob: 'a'.repeat(2000) } }),
    });
    expect(res.status).toBe(413);
    await res.text();
  });

  it('returns 400 / parse-error for malformed JSON', async () => {
    await connectClient();
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: '{ not valid json ',
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { code?: number } };
    expect(body.error?.code).toBe(-32700);
  });

  it('refuses to start on a non-loopback host without auth (fail-closed)', async () => {
    const config = resolveTransportConfig(
      { QVERIS_MCP_TRANSPORT: 'http', QVERIS_MCP_HTTP_HOST: '0.0.0.0', QVERIS_MCP_HTTP_PORT: '0' },
      [],
    );
    await expect(startHttpServer(config, (sessionId) => createQverisServer(undefined, sessionId))).rejects.toThrow(
      /non-loopback/,
    );
  });

  it('treats a 127.x hostname as non-loopback (precise address check, not a prefix)', async () => {
    // `127.example.com` must NOT be mistaken for the 127.0.0.0/8 loopback range;
    // it fails closed (throws before any bind is attempted).
    const config = resolveTransportConfig(
      { QVERIS_MCP_TRANSPORT: 'http', QVERIS_MCP_HTTP_HOST: '127.example.com', QVERIS_MCP_HTTP_PORT: '0' },
      [],
    );
    await expect(startHttpServer(config, (sessionId) => createQverisServer(undefined, sessionId))).rejects.toThrow(
      /non-loopback/,
    );
  });

  it('allows a non-loopback bind once a token is set', async () => {
    await startServer({ QVERIS_MCP_HTTP_HOST: '0.0.0.0', QVERIS_MCP_HTTP_AUTH_TOKEN: 'tok' });
    const res = await fetch(`http://127.0.0.1:${running!.port}/health`);
    expect(res.status).toBe(200);
    await res.text();
  });

  it('serves the Server Card unauthenticated with the right media type and CORS', async () => {
    // A token is set to prove the card is reachable WITHOUT credentials.
    await startServer({ QVERIS_MCP_HTTP_AUTH_TOKEN: 'tok' }, CARD_INFO);
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp/server-card`, {
      headers: { Accept: 'application/mcp-server-card+json' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/mcp-server-card+json');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    // Host-derived origin must not be cached cross-host (poisoning guard).
    expect(res.headers.get('cache-control')).toContain('no-store');
    expect(res.headers.get('vary')).toContain('Host');
    const card = (await res.json()) as Record<string, unknown>;
    expect(card.name).toBe('io.github.QVerisAI/mcp');
    expect(card.version).toBe('9.9.9');
    expect((card.remotes as Array<{ url: string }>)[0].url).toBe(`http://127.0.0.1:${running!.port}/mcp`);
  });

  it('serves the MCP Catalog pointing at the Server Card', async () => {
    await startServer({}, CARD_INFO);
    const res = await fetch(`http://127.0.0.1:${running!.port}/.well-known/mcp/catalog.json`);
    expect(res.status).toBe(200);
    const catalog = (await res.json()) as { specVersion: string; entries: Array<Record<string, string>> };
    expect(catalog.specVersion).toBe('draft');
    expect(catalog.entries[0].mediaType).toBe('application/mcp-server-card+json');
    expect(catalog.entries[0].url).toBe(`http://127.0.0.1:${running!.port}/mcp/server-card`);
    expect(catalog.entries[0].identifier).toBe('urn:air:qveris.ai:mcp');
  });

  it('answers a CORS preflight for the Server Card', async () => {
    await startServer({}, CARD_INFO);
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp/server-card`, { method: 'OPTIONS' });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-methods')).toContain('GET');
    await res.text();
  });

  it('refuses to start when the HTTP path collides with a reserved endpoint', async () => {
    const config = resolveTransportConfig(
      { QVERIS_MCP_TRANSPORT: 'http', QVERIS_MCP_HTTP_PORT: '0', QVERIS_MCP_HTTP_PATH: '/health' },
      [],
    );
    await expect(
      startHttpServer(config, (sessionId) => createQverisServer(undefined, sessionId), CARD_INFO),
    ).rejects.toThrow(/reserved endpoint/);
  });

  it('does not serve discovery endpoints when no card info is provided', async () => {
    await startServer(); // no cardInfo
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp/server-card`, {
      headers: { Accept: 'application/mcp-server-card+json' },
    });
    expect(res.status).toBe(404);
    await res.text();
  });

  it('honors QVERIS_MCP_PUBLIC_URL in discovery URLs (behind a proxy)', async () => {
    await startServer({ QVERIS_MCP_PUBLIC_URL: 'https://mcp.example.com' }, CARD_INFO);
    const res = await fetch(`http://127.0.0.1:${running!.port}/mcp/server-card`);
    // A configured public origin is host-independent, so it's freely cacheable.
    expect(res.headers.get('cache-control')).toContain('public');
    const card = (await res.json()) as { remotes: Array<{ url: string }> };
    expect(card.remotes[0].url).toBe('https://mcp.example.com/mcp');
  });
});
