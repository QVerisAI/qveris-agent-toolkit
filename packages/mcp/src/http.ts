/**
 * Streamable HTTP transport for the Qveris MCP server.
 *
 * Adds a remote transport mode (MCP Streamable HTTP) alongside the default
 * stdio transport, so the same server can run locally over stdio or be deployed
 * behind HTTP for Claude Desktop Custom Connectors and other remote MCP clients.
 *
 * The transport is stateful: each client session gets its own
 * {@link StreamableHTTPServerTransport} (and its own Qveris {@link Server}),
 * keyed by the `Mcp-Session-Id` header the SDK assigns on `initialize`.
 *
 * Inbound auth is an optional shared bearer token (`QVERIS_MCP_HTTP_AUTH_TOKEN`).
 * When binding a non-loopback host the server refuses to start unless a token is
 * set (or auth is explicitly delegated to an external layer). OAuth 2.1 and the
 * `.well-known` Server Card are tracked as follow-ups to issue #107.
 *
 * @module @qverisai/mcp/http
 */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';

/** Transport selection plus the HTTP-mode settings. */
export interface TransportConfig {
  mode: 'stdio' | 'http';
  host: string;
  port: number;
  /** Request path the MCP endpoint is served on (default `/mcp`). */
  path: string;
  /** Extra `Host` header values accepted when DNS-rebinding protection is on. */
  allowedHosts: string[];
  /** Extra `Origin` header values accepted when DNS-rebinding protection is on. */
  allowedOrigins: string[];
  /** Reject requests whose Host/Origin isn't allow-listed (default on). */
  enableDnsRebindingProtection: boolean;
  /** Return JSON responses instead of an SSE stream (default off). */
  enableJsonResponse: boolean;
  /** Shared bearer token required on the MCP endpoint; unset = no inbound auth. */
  authToken?: string;
  /** Allow a non-loopback bind without a token (auth delegated externally). */
  allowUnauthenticated: boolean;
  /** Max accepted request body size in bytes (413 beyond it). */
  maxBodyBytes: number;
  /** Idle session TTL in ms; stale sessions are closed and evicted. */
  sessionTimeoutMs: number;
}

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PATH = '/mcp';
const DEFAULT_MAX_BODY_BYTES = 4 * 1024 * 1024; // 4 MiB
const DEFAULT_SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const SWEEP_INTERVAL_MS = 60 * 1000; // idle-session sweep cadence
const MAX_PORT = 65535;

class BodyTooLargeError extends Error {}
class JsonParseError extends Error {}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readFlag(argv: string[], name: string): string | undefined {
  // Supports `--name value` and `--name=value`.
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === name) {
      const next = argv[i + 1];
      return next && !next.startsWith('--') ? next : '';
    }
    if (arg.startsWith(`${name}=`)) {
      return arg.slice(name.length + 1);
    }
  }
  return undefined;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

// Matches the whole IPv4 loopback range 127.0.0.0/8 (and only that) — a precise
// address check, not a `startsWith('127.')` prefix that would also accept a
// hostname like `127.example.com`.
const IPV4_LOOPBACK = /^127(?:\.(?:0|[1-9]\d?|1\d\d|2[0-4]\d|25[0-5])){3}$/;

function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/^\[|\]$/g, ''); // strip IPv6 brackets
  return h === 'localhost' || h === '::1' || IPV4_LOOPBACK.test(h);
}

/**
 * Resolve the transport configuration from environment and CLI flags.
 *
 * HTTP mode is selected when `--http` is passed, `QVERIS_MCP_TRANSPORT=http`,
 * or an HTTP port/host is explicitly set; otherwise the transport stays stdio
 * so existing local configs are unaffected.
 */
export function resolveTransportConfig(
  env: NodeJS.ProcessEnv,
  argv: string[] = [],
): TransportConfig {
  const portFlag = readFlag(argv, '--port');
  const hostFlag = readFlag(argv, '--host');
  const pathFlag = readFlag(argv, '--path');

  const envPort = env.QVERIS_MCP_HTTP_PORT;
  const envHost = env.QVERIS_MCP_HTTP_HOST;
  const envTransport = env.QVERIS_MCP_TRANSPORT?.trim().toLowerCase();

  const httpRequested =
    hasFlag(argv, '--http') ||
    envTransport === 'http' ||
    portFlag !== undefined ||
    envPort !== undefined ||
    hostFlag !== undefined ||
    envHost !== undefined;

  const mode: TransportConfig['mode'] =
    envTransport === 'stdio' ? 'stdio' : httpRequested ? 'http' : 'stdio';

  const rawPort = portFlag || envPort;
  const parsedPort = Number(rawPort);
  const port =
    rawPort !== undefined &&
    rawPort.trim() !== '' && // e.g. a bare `--port` -> '' -> Number('') === 0; fall back instead
    Number.isInteger(parsedPort) &&
    parsedPort >= 0 &&
    parsedPort <= MAX_PORT
      ? parsedPort
      : DEFAULT_PORT;

  return {
    mode,
    host: hostFlag || envHost || DEFAULT_HOST,
    port,
    path: pathFlag || env.QVERIS_MCP_HTTP_PATH || DEFAULT_PATH,
    allowedHosts: parseList(env.QVERIS_MCP_ALLOWED_HOSTS),
    allowedOrigins: parseList(env.QVERIS_MCP_ALLOWED_ORIGINS),
    enableDnsRebindingProtection: parseBool(env.QVERIS_MCP_DNS_REBINDING_PROTECTION, true),
    enableJsonResponse: parseBool(env.QVERIS_MCP_HTTP_JSON, false),
    authToken: env.QVERIS_MCP_HTTP_AUTH_TOKEN?.trim() || undefined,
    allowUnauthenticated: parseBool(env.QVERIS_MCP_HTTP_ALLOW_UNAUTHENTICATED, false),
    maxBodyBytes: parsePositiveInt(env.QVERIS_MCP_MAX_BODY_BYTES, DEFAULT_MAX_BODY_BYTES),
    sessionTimeoutMs: parsePositiveInt(env.QVERIS_MCP_SESSION_TIMEOUT_MS, DEFAULT_SESSION_TIMEOUT_MS),
  };
}

/** Read and JSON-parse a request body with a hard size cap. */
async function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    total += buf.length;
    if (total > maxBytes) {
      throw new BodyTooLargeError(`Request body exceeds ${maxBytes} bytes`);
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return undefined;
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw.trim().length === 0) return undefined;
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new JsonParseError(err instanceof Error ? err.message : 'Invalid JSON');
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', ...headers });
  res.end(payload);
}

function jsonRpcError(id: unknown, code: number, message: string) {
  return { jsonrpc: '2.0' as const, error: { code, message }, id: id ?? null };
}

/** Constant-time bearer check against the configured token. */
function bearerMatches(authHeader: string | undefined, token: string): boolean {
  if (!authHeader) return false;
  const prefix = 'bearer ';
  if (!authHeader.toLowerCase().startsWith(prefix)) return false;
  const provided = authHeader.slice(prefix.length).trim();
  // Compare fixed-length SHA-256 digests so the comparison is constant-time
  // *and* doesn't leak the expected token's length via an early length check.
  const providedHash = createHash('sha256').update(provided).digest();
  const expectedHash = createHash('sha256').update(token).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

/** Handle to a running HTTP server. */
export interface RunningHttpServer {
  httpServer: HttpServer;
  /** The port actually bound (useful when config.port is 0). */
  port: number;
  /** Close all sessions and stop the HTTP server. */
  close: () => Promise<void>;
}

/**
 * Start the Streamable HTTP server.
 *
 * @param config - Resolved HTTP transport settings.
 * @param makeServer - Factory that builds a fresh Qveris {@link Server} for a
 *   new client session. Called once per `initialize`.
 * @param logger - Where to write startup/lifecycle lines (defaults to stderr,
 *   keeping stdout clean).
 * @throws if binding a non-loopback host without an auth token and without an
 *   explicit opt-out (fail-closed).
 */
export async function startHttpServer(
  config: TransportConfig,
  makeServer: (sessionId: string) => Server,
  logger: (message: string) => void = (message) => process.stderr.write(message),
): Promise<RunningHttpServer> {
  const nonLoopback = !isLoopbackHost(config.host);
  if (nonLoopback && !config.authToken && !config.allowUnauthenticated) {
    throw new Error(
      `Refusing to start: HTTP transport is binding a non-loopback host (${config.host}) with no authentication. ` +
        `Set QVERIS_MCP_HTTP_AUTH_TOKEN to require a bearer token, or set ` +
        `QVERIS_MCP_HTTP_ALLOW_UNAUTHENTICATED=true if an external layer (proxy/gateway) authenticates requests.`,
    );
  }
  if (nonLoopback && !config.authToken) {
    logger(
      '[qveris] WARNING: HTTP transport exposed on a non-loopback host without an auth token. ' +
        'Ensure an external auth layer protects the endpoint.\n',
    );
  }

  const transports = new Map<string, StreamableHTTPServerTransport>();
  const lastSeen = new Map<string, number>();
  const inflight = new Map<string, number>(); // requests currently being handled per session
  let boundPort = config.port;

  // In-flight guards keep the idle sweep from evicting a session that has an
  // active request or a live (long-lived) SSE stream. A session is only
  // eligible for idle eviction once it has zero in-flight requests.
  const retain = (sessionId: string): void => {
    inflight.set(sessionId, (inflight.get(sessionId) ?? 0) + 1);
  };
  const release = (sessionId: string): void => {
    const remaining = (inflight.get(sessionId) ?? 0) - 1;
    if (remaining > 0) inflight.set(sessionId, remaining);
    else inflight.delete(sessionId);
  };

  // The SDK matches the Host header (which includes the port) against
  // allowedHosts. Build the effective list once the real port is known so DNS
  // rebinding protection works even when config.port is 0 (ephemeral).
  const effectiveAllowedHosts = (): string[] => {
    const base = [
      `${config.host}:${boundPort}`,
      `localhost:${boundPort}`,
      `127.0.0.1:${boundPort}`,
    ];
    return [...new Set([...base, ...config.allowedHosts])];
  };

  const evict = (sessionId: string): void => {
    lastSeen.delete(sessionId);
    inflight.delete(sessionId);
    if (transports.get(sessionId)) transports.delete(sessionId);
  };

  const createTransport = async (): Promise<StreamableHTTPServerTransport> => {
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableJsonResponse: config.enableJsonResponse,
      enableDnsRebindingProtection: config.enableDnsRebindingProtection,
      allowedHosts: effectiveAllowedHosts(),
      allowedOrigins: config.allowedOrigins,
      onsessioninitialized: (sessionId) => {
        transports.set(sessionId, transport);
        lastSeen.set(sessionId, Date.now());
        logger(`[qveris] MCP session initialized: ${sessionId}\n`);
      },
    });
    transport.onclose = () => {
      const sessionId = transport.sessionId;
      if (sessionId && transports.get(sessionId) === transport) {
        evict(sessionId);
        logger(`[qveris] MCP session closed: ${sessionId}\n`);
      }
    };
    const server = makeServer(randomUUID());
    await server.connect(transport);
    return transport;
  };

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      // Lightweight, unauthenticated health check for load balancers.
      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { status: 'ok', transport: 'streamable-http' });
        return;
      }

      if (url.pathname !== config.path) {
        req.resume(); // drain the body so the connection can be reused/closed
        writeJson(res, 404, jsonRpcError(null, -32601, `Not found: ${url.pathname}`));
        return;
      }

      // Inbound auth (when a token is configured) on the MCP endpoint.
      if (config.authToken && !bearerMatches(req.headers['authorization'], config.authToken)) {
        req.resume(); // drain the (unread) body before short-circuiting
        writeJson(res, 401, jsonRpcError(null, -32001, 'Unauthorized'), {
          'WWW-Authenticate': 'Bearer',
        });
        return;
      }

      const sessionId = req.headers['mcp-session-id'];
      const existing =
        typeof sessionId === 'string' ? transports.get(sessionId) : undefined;
      if (typeof sessionId === 'string' && existing) lastSeen.set(sessionId, Date.now());

      if (req.method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(req, config.maxBodyBytes);
        } catch (err) {
          if (err instanceof BodyTooLargeError) {
            // Don't drain the rest of an oversized upload — terminate the
            // connection so an attacker can't keep streaming a huge body.
            writeJson(res, 413, jsonRpcError(null, -32600, 'Request body too large'), {
              Connection: 'close',
            });
            req.destroy();
            return;
          }
          if (err instanceof JsonParseError) {
            writeJson(res, 400, jsonRpcError(null, -32700, 'Parse error'));
            return;
          }
          throw err;
        }

        let transport = existing;
        if (!transport) {
          if (sessionId !== undefined) {
            writeJson(res, 404, jsonRpcError(null, -32001, 'Session not found'));
            return;
          }
          if (!isInitializeRequest(body)) {
            writeJson(
              res,
              400,
              jsonRpcError(null, -32000, 'Missing session ID: first request must be initialize'),
            );
            return;
          }
          transport = await createTransport();
        }

        // Guard only requests against an existing session (a known id); a fresh
        // initialize gets its id mid-handle and can't be swept in that window.
        if (existing && typeof sessionId === 'string') {
          retain(sessionId);
          try {
            await transport.handleRequest(req, res, body);
          } finally {
            release(sessionId);
          }
        } else {
          await transport.handleRequest(req, res, body);
        }
        return;
      }

      // GET (SSE stream) and DELETE (session teardown) require a live session.
      if (req.method === 'GET' || req.method === 'DELETE') {
        if (!existing || typeof sessionId !== 'string') {
          writeJson(res, 404, jsonRpcError(null, -32001, 'Invalid or missing session ID'));
          return;
        }
        // A GET holds the SSE stream open for the session's lifetime; retaining
        // it keeps the idle sweep from tearing down an active channel.
        retain(sessionId);
        try {
          await existing.handleRequest(req, res);
        } finally {
          release(sessionId);
        }
        return;
      }

      req.resume();
      res.writeHead(405, { Allow: 'GET, POST, DELETE' });
      res.end();
    } catch (error) {
      logger(`[qveris] HTTP handler error: ${error instanceof Error ? error.message : error}\n`);
      if (!res.headersSent) {
        writeJson(res, 500, jsonRpcError(null, -32603, 'Internal server error'));
      }
    }
  };

  const httpServer = createServer((req, res) => {
    void handler(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, config.host, () => {
      httpServer.removeListener('error', reject);
      const address = httpServer.address() as AddressInfo | null;
      if (address) boundPort = address.port;
      resolve();
    });
  });

  // Keep a persistent error handler so a post-startup server error (e.g. EMFILE)
  // is logged instead of crashing the process as an unhandled 'error' event.
  httpServer.on('error', (err: Error) => {
    logger(`[qveris] HTTP server error: ${err.message}\n`);
  });

  // Evict idle sessions so abandoned connections don't leak transports/servers.
  // Sessions with an in-flight request or an open SSE stream are skipped so an
  // active call is never torn down mid-flight.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [sessionId, seen] of lastSeen) {
      if (now - seen > config.sessionTimeoutMs && !inflight.get(sessionId)) {
        const transport = transports.get(sessionId);
        evict(sessionId);
        if (transport) void transport.close().catch(() => undefined);
        logger(`[qveris] MCP session evicted (idle): ${sessionId}\n`);
      }
    }
  }, SWEEP_INTERVAL_MS);
  sweep.unref();

  logger(
    `[qveris] Qveris MCP Server started (streamable-http) on http://${config.host}:${boundPort}${config.path}\n`,
  );

  const close = async (): Promise<void> => {
    clearInterval(sweep);
    for (const transport of transports.values()) {
      await transport.close().catch(() => undefined);
    }
    transports.clear();
    lastSeen.clear();
    inflight.clear();
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
      // Don't wait out idle keep-alive sockets (clients pool connections and
      // hold them open for seconds); force them closed so shutdown is prompt.
      httpServer.closeAllConnections?.();
    });
  };

  return { httpServer, port: boundPort, close };
}
