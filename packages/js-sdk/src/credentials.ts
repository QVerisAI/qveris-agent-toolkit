import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import type { ApiOperation } from './types.js';

export type CredentialPurpose = 'data_read' | 'paid_execution' | 'usage_audit' | 'ledger_audit';

/** Context supplied whenever the client requests a credential. */
export interface CredentialContext {
  /** API resource the credential will be sent to. */
  resource: string;

  /** Exact OAuth resource/audience required by the request. */
  audience?: string;

  /** Requested authorization scopes. */
  scopes: readonly string[];

  /** Logical QVeris operation. */
  operation?: ApiOperation;

  /** Security purpose of the operation. */
  purpose?: CredentialPurpose;

  /** Optional non-sensitive session reference. */
  sessionId?: string;

  /** Optional non-sensitive correlation reference. */
  correlationId?: string;
}

/** Supplies a bearer credential for an API request. */
export interface CredentialProvider {
  getCredential(context: CredentialContext): string | Promise<string>;
}

/** A credential provider backed by a static QVeris API key. */
export class ApiKeyCredentialProvider implements CredentialProvider {
  readonly #apiKey: string;

  constructor(apiKey: string) {
    const value = apiKey.trim();
    if (!value || /[\r\n]/.test(value)) {
      throw new Error('QVeris API key is required.');
    }
    this.#apiKey = value;
  }

  async getCredential(_context: CredentialContext): Promise<string> {
    return this.#apiKey;
  }
}

/** Optional restrictions embedded in a short-lived Agent delegation token. */
export interface AgentDelegationConstraints {
  model?: string;
  toolIds?: readonly string[];
  providerIds?: readonly string[];
  runId?: string;
  maxCredits?: number;
}

/** Configuration for {@link AgentDelegationCredentialProvider}. */
export interface AgentDelegationCredentialProviderOptions {
  /** Exact published OAuth token endpoint, for example `https://qveris.ai/api/v1/oauth/token`. */
  tokenEndpoint: string;
  /** Registered confidential Agent Runtime client id. */
  clientId: string;
  /** Registered confidential Agent Runtime client secret. Never logged or persisted by the provider. */
  clientSecret: string;
  /** Supplies the user's OAuth access token used as the RFC 8693 subject token. */
  subjectCredentialProvider: CredentialProvider;
  /** Exact QVeris resource/audience for the delegated token. */
  resource: string;
  /** Maximum scope set that may be requested by this provider. */
  scopes: readonly string[];
  /** Optional narrowing constraints. */
  constraints?: AgentDelegationConstraints;
  /** Optional fetch implementation for controlled runtimes and tests. */
  fetch?: typeof fetch;
  /** Maximum token-exchange duration in milliseconds. Defaults to 30000. */
  exchangeTimeoutMs?: number;
  /** Refresh skew applied to the in-memory token cache. Defaults to 30 seconds. */
  expirySkewSeconds?: number;
}

export type AgentDelegationErrorCode =
  | 'invalid_configuration'
  | 'context_mismatch'
  | 'subject_credential_failed'
  | 'token_exchange_failed'
  | 'invalid_token_response';

/** Credential-safe Agent delegation failure. */
export class AgentDelegationError extends Error {
  readonly code: AgentDelegationErrorCode;
  readonly status?: number;

  constructor(code: AgentDelegationErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'AgentDelegationError';
    this.code = code;
    this.status = status;
  }
}

interface DelegationToken {
  accessToken: string;
  expiresAtMs: number;
  scope: ReadonlySet<string>;
}

const TOKEN_EXCHANGE_GRANT = 'urn:ietf:params:oauth:grant-type:token-exchange';
const ACCESS_TOKEN_TYPE = 'urn:ietf:params:oauth:token-type:access_token';
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;

/**
 * Exchanges a user OAuth access token for a short-lived, non-refreshable Agent token.
 *
 * Tokens are cached only in memory, never written to disk, and exchanged again only
 * after the cached token reaches its refresh boundary. The provider requires the
 * client request context to match its configured resource and scope ceiling.
 */
export class AgentDelegationCredentialProvider implements CredentialProvider {
  readonly #tokenEndpoint: string;
  readonly #clientId: string;
  readonly #clientSecret: string;
  readonly #subjectCredentialProvider: CredentialProvider;
  readonly #resource: string;
  readonly #scopes: readonly string[];
  readonly #scopeSet: ReadonlySet<string>;
  readonly #constraints: AgentDelegationConstraints;
  readonly #fetch: typeof fetch;
  readonly #exchangeTimeoutMs: number;
  readonly #expirySkewSeconds: number;
  readonly #cached = new Map<string, DelegationToken>();
  readonly #exchanges = new Map<string, Promise<DelegationToken>>();

  constructor(options: AgentDelegationCredentialProviderOptions) {
    this.#tokenEndpoint = validateHttpUrl(options.tokenEndpoint, 'tokenEndpoint', true);
    this.#clientId = validateSecret(options.clientId, 'clientId');
    this.#clientSecret = validateSecret(options.clientSecret, 'clientSecret');
    if (!options.subjectCredentialProvider || typeof options.subjectCredentialProvider.getCredential !== 'function') {
      throw new AgentDelegationError(
        'invalid_configuration',
        'subjectCredentialProvider must implement getCredential().',
      );
    }
    this.#subjectCredentialProvider = options.subjectCredentialProvider;
    this.#resource = validateHttpUrl(options.resource, 'resource');
    this.#scopes = normalizeScopes(options.scopes);
    this.#scopeSet = new Set(this.#scopes);
    this.#constraints = validateConstraints(options.constraints ?? {});
    this.#fetch = options.fetch ?? globalThis.fetch;
    if (typeof this.#fetch !== 'function') {
      throw new AgentDelegationError('invalid_configuration', 'A fetch implementation is required.');
    }
    const exchangeTimeoutMs = options.exchangeTimeoutMs ?? 30_000;
    if (!Number.isFinite(exchangeTimeoutMs) || exchangeTimeoutMs <= 0) {
      throw new AgentDelegationError('invalid_configuration', 'exchangeTimeoutMs must be positive.');
    }
    this.#exchangeTimeoutMs = exchangeTimeoutMs;
    const skew = options.expirySkewSeconds ?? 30;
    if (!Number.isFinite(skew) || skew < 0 || skew >= 600) {
      throw new AgentDelegationError('invalid_configuration', 'expirySkewSeconds must be between 0 and 599.');
    }
    this.#expirySkewSeconds = skew;
  }

  async getCredential(context: CredentialContext): Promise<string> {
    const requiredScopes = this.#validateContext(context);
    const subjectToken = await this.#resolveSubjectToken(context);
    const cacheKey = delegationCacheKey(subjectToken, requiredScopes);
    const now = Date.now();
    const cached = this.#cached.get(cacheKey);
    if (cached && cached.expiresAtMs > now && isSubset(requiredScopes, cached.scope)) {
      return cached.accessToken;
    }

    let exchange = this.#exchanges.get(cacheKey);
    if (!exchange) {
      exchange = this.#exchangeToken(subjectToken, requiredScopes).finally(() => {
        this.#exchanges.delete(cacheKey);
      });
      this.#exchanges.set(cacheKey, exchange);
    }
    const token = await exchange;
    if (!isSubset(requiredScopes, token.scope)) {
      throw new AgentDelegationError('invalid_token_response', 'Delegation token does not cover the requested scopes.');
    }
    this.#cached.set(cacheKey, token);
    return token.accessToken;
  }

  /** Drop the in-memory token without revoking or persisting it. */
  clear(): void {
    this.#cached.clear();
  }

  #validateContext(context: CredentialContext): ReadonlySet<string> {
    if (context.audience !== this.#resource) {
      throw new AgentDelegationError(
        'context_mismatch',
        'Credential context audience does not match the delegated resource.',
      );
    }
    const requested = new Set(normalizeScopes(context.scopes));
    if (!isSubset(requested, this.#scopeSet)) {
      throw new AgentDelegationError(
        'context_mismatch',
        'Credential context requests scopes outside the delegation ceiling.',
      );
    }
    return requested;
  }

  async #resolveSubjectToken(context: CredentialContext): Promise<string> {
    try {
      return await resolveCredential(this.#subjectCredentialProvider, context);
    } catch {
      throw new AgentDelegationError(
        'subject_credential_failed',
        'The subject credential provider failed to provide a user access token.',
      );
    }
  }

  async #exchangeToken(subjectToken: string, requiredScopes: ReadonlySet<string>): Promise<DelegationToken> {
    const form = new URLSearchParams({
      grant_type: TOKEN_EXCHANGE_GRANT,
      subject_token: subjectToken,
      subject_token_type: ACCESS_TOKEN_TYPE,
      requested_token_type: ACCESS_TOKEN_TYPE,
      resource: this.#resource,
      scope: [...requiredScopes].sort().join(' '),
    });
    appendConstraints(form, this.#constraints);

    let response: Response;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.#exchangeTimeoutMs);
    try {
      response = await this.#fetch(this.#tokenEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${encodeClientCredentials(this.#clientId, this.#clientSecret)}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: form,
        redirect: 'error',
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timeout);
      throw new AgentDelegationError(
        'token_exchange_failed',
        'Agent token exchange failed before a response was received.',
      );
    }

    const contentLength = Number(response.headers.get('content-length') ?? 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_TOKEN_RESPONSE_BYTES) {
      // A declared oversize response has not been read yet, so explicitly
      // cancel the body rather than leaving its connection/stream open.
      void response.body?.cancel().catch(() => undefined);
      clearTimeout(timeout);
      throw new AgentDelegationError('invalid_token_response', 'Agent token response exceeded the size limit.');
    }
    let responseText: string;
    try {
      responseText = await readBoundedResponseText(response);
    } catch (error) {
      if (error instanceof AgentDelegationError) throw error;
      throw new AgentDelegationError('token_exchange_failed', 'Agent token exchange response could not be read.');
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) {
      throw new AgentDelegationError('token_exchange_failed', 'Agent token exchange was rejected.', response.status);
    }

    let payload: unknown;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response was not valid JSON.');
    }
    return this.#validateTokenResponse(payload, requiredScopes);
  }

  #validateTokenResponse(value: unknown, requiredScopes: ReadonlySet<string>): DelegationToken {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response had an invalid shape.');
    }
    const payload = value as Record<string, unknown>;
    if ('refresh_token' in payload) {
      throw new AgentDelegationError('invalid_token_response', 'Delegation tokens must not include a refresh token.');
    }
    const accessToken = validateReturnedToken(payload.access_token);
    if (payload.token_type !== 'Bearer' || payload.issued_token_type !== ACCESS_TOKEN_TYPE) {
      throw new AgentDelegationError(
        'invalid_token_response',
        'Agent token response declared an unsupported token type.',
      );
    }
    const expiresIn = payload.expires_in;
    if (!Number.isInteger(expiresIn) || (expiresIn as number) <= 0 || (expiresIn as number) > 600) {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response declared an invalid lifetime.');
    }
    if (payload.resource !== this.#resource || typeof payload.scope !== 'string') {
      throw new AgentDelegationError(
        'invalid_token_response',
        'Agent token response changed the delegated resource or scope.',
      );
    }
    const responseScopes = new Set(normalizeScopes(payload.scope.split(/\s+/)));
    if (!isSubset(responseScopes, requiredScopes)) {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response widened the requested scopes.');
    }
    validateReturnedConstraints(payload.constraints, this.#constraints);
    const skewSeconds = Math.min(this.#expirySkewSeconds, (expiresIn as number) / 2);
    return {
      accessToken,
      expiresAtMs: Date.now() + ((expiresIn as number) - skewSeconds) * 1000,
      scope: responseScopes,
    };
  }
}

/**
 * Keep caches non-secret while partitioning every token by the user credential
 * that authorized its exchange and by the exact scope request.
 */
function delegationCacheKey(subjectToken: string, requiredScopes: ReadonlySet<string>): string {
  const subjectFingerprint = createHash('sha256').update(subjectToken).digest('base64url');
  return `${subjectFingerprint}:${JSON.stringify([...requiredScopes].sort())}`;
}

/** Resolve and validate a provider value without exposing it in errors. */
export async function resolveCredential(provider: CredentialProvider, context: CredentialContext): Promise<string> {
  let credential: string;
  try {
    credential = await provider.getCredential(context);
  } catch (error) {
    if (error instanceof AgentDelegationError) throw error;
    // Deliberately omit an unknown provider cause: it may retain credential material.
    // eslint-disable-next-line preserve-caught-error
    throw new Error('QVeris credential provider failed to provide a credential.');
  }
  if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/.test(credential)) {
    throw new Error('QVeris credential provider returned an invalid credential.');
  }
  return credential.trim();
}

function validateHttpUrl(value: string, label: string, requireSecure = false): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new AgentDelegationError('invalid_configuration', `${label} must be a valid HTTP(S) URL.`);
  }
  try {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) throw new Error();
    if (requireSecure && url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) throw new Error();
    if (url.search || url.hash) throw new Error();
    return url.toString().replace(/\/$/, '');
  } catch {
    throw new AgentDelegationError('invalid_configuration', `${label} must be a valid HTTP(S) URL.`);
  }
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
}

function validateSecret(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new AgentDelegationError('invalid_configuration', `${label} is invalid.`);
  }
  return value;
}

function encodeClientCredentials(clientId: string, clientSecret: string): string {
  const encode = (value: string): string => new URLSearchParams({ value }).toString().slice('value='.length);
  return Buffer.from(`${encode(clientId)}:${encode(clientSecret)}`, 'utf8').toString('base64');
}

/** Read a token response without allowing an unbounded body into memory. */
async function readBoundedResponseText(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    // Some fetch-compatible test doubles expose only text(). Production fetch
    // implementations provide a stream, so this path cannot weaken the live cap.
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > MAX_TOKEN_RESPONSE_BYTES) {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response exceeded the size limit.');
    }
    return text;
  }

  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > MAX_TOKEN_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new AgentDelegationError('invalid_token_response', 'Agent token response exceeded the size limit.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validateReturnedToken(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || /[\r\n]/.test(value)) {
    throw new AgentDelegationError(
      'invalid_token_response',
      'Agent token response did not contain a valid access token.',
    );
  }
  return value.trim();
}

function normalizeScopes(scopes: readonly string[]): readonly string[] {
  if (!Array.isArray(scopes)) {
    throw new AgentDelegationError('invalid_configuration', 'scopes must be a non-empty array.');
  }
  const values = [...new Set(scopes.map((scope) => (typeof scope === 'string' ? scope.trim() : '')))].filter(Boolean);
  if (values.length === 0 || values.some((scope) => /\s/.test(scope))) {
    throw new AgentDelegationError('invalid_configuration', 'scopes must contain non-empty OAuth scope tokens.');
  }
  return values.sort();
}

function validateConstraints(value: AgentDelegationConstraints): AgentDelegationConstraints {
  const constraints: AgentDelegationConstraints = {};
  if (value.model !== undefined) constraints.model = validateConstraintString(value.model, 'model');
  if (value.runId !== undefined) constraints.runId = validateConstraintString(value.runId, 'runId');
  if (value.toolIds !== undefined) constraints.toolIds = validateConstraintList(value.toolIds, 'toolIds');
  if (value.providerIds !== undefined)
    constraints.providerIds = validateConstraintList(value.providerIds, 'providerIds');
  if (value.maxCredits !== undefined) {
    if (!Number.isInteger(value.maxCredits) || value.maxCredits <= 0) {
      throw new AgentDelegationError('invalid_configuration', 'maxCredits must be a positive integer.');
    }
    constraints.maxCredits = value.maxCredits;
  }
  return Object.freeze(constraints);
}

function validateConstraintString(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\r\n]/.test(value)) {
    throw new AgentDelegationError('invalid_configuration', `${label} is invalid.`);
  }
  return value.trim();
}

function validateConstraintList(values: readonly string[], label: string): readonly string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > 100) {
    throw new AgentDelegationError('invalid_configuration', `${label} must contain between 1 and 100 values.`);
  }
  return Object.freeze([...new Set(values.map((value) => validateConstraintString(value, label)))]);
}

function appendConstraints(form: URLSearchParams, constraints: AgentDelegationConstraints): void {
  if (constraints.model !== undefined) form.set('model', constraints.model);
  if (constraints.runId !== undefined) form.set('run_id', constraints.runId);
  if (constraints.maxCredits !== undefined) form.set('max_credits', String(constraints.maxCredits));
  for (const toolId of constraints.toolIds ?? []) form.append('tool_ids', toolId);
  for (const providerId of constraints.providerIds ?? []) form.append('provider_ids', providerId);
}

function validateReturnedConstraints(value: unknown, requested: AgentDelegationConstraints): void {
  const returned =
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  for (const [wireName, requestedValue] of [
    ['model', requested.model],
    ['run_id', requested.runId],
  ] as const) {
    if (requestedValue !== undefined && returned[wireName] !== requestedValue) {
      throw new AgentDelegationError(
        'invalid_token_response',
        'Agent token response did not preserve a requested constraint.',
      );
    }
  }
  if (requested.maxCredits !== undefined) {
    const returnedCredits = returned.max_credits;
    if (
      !Number.isInteger(returnedCredits) ||
      (returnedCredits as number) <= 0 ||
      (returnedCredits as number) > requested.maxCredits
    ) {
      throw new AgentDelegationError('invalid_token_response', 'Agent token response widened the credit constraint.');
    }
  }
  validateReturnedListConstraint(returned.tool_ids, requested.toolIds);
  validateReturnedListConstraint(returned.provider_ids, requested.providerIds);
}

function validateReturnedListConstraint(value: unknown, requested: readonly string[] | undefined): void {
  if (requested === undefined) return;
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new AgentDelegationError(
      'invalid_token_response',
      'Agent token response omitted a requested list constraint.',
    );
  }
  if (!isSubset(new Set(value as string[]), new Set(requested))) {
    throw new AgentDelegationError(
      'invalid_token_response',
      'Agent token response widened a requested list constraint.',
    );
  }
}

function isSubset(values: ReadonlySet<string>, ceiling: ReadonlySet<string>): boolean {
  for (const value of values) if (!ceiling.has(value)) return false;
  return true;
}
