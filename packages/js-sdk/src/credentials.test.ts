import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentDelegationCredentialProvider,
  AgentDelegationError,
  ApiKeyCredentialProvider,
  resolveCredential,
  type CredentialContext,
  type CredentialProvider,
} from './credentials.js';

const TOKEN_ENDPOINT = 'https://qveris.ai/api/v1/oauth/token';
const RESOURCE = 'https://api.qveris.ai/tools';
const CLIENT_ID = 'agent runtime:id';
const CLIENT_SECRET = 'synthetic: client+secret';
const SUBJECT_TOKEN = 'synthetic-user-access-token';
const DELEGATION_TOKEN = 'synthetic-delegation-token';

const CONTEXT: CredentialContext = {
  resource: 'https://qveris.ai/api/v1',
  audience: RESOURCE,
  scopes: ['tools.execute'],
  operation: 'call',
  purpose: 'paid_execution',
  sessionId: 'session-1',
};

function tokenResponse(overrides: Record<string, unknown> = {}, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) headers.set('content-type', 'application/json');
  return new Response(
    JSON.stringify({
      access_token: DELEGATION_TOKEN,
      issued_token_type: 'urn:ietf:params:oauth:token-type:access_token',
      token_type: 'Bearer',
      expires_in: 600,
      scope: 'tools.inspect tools.execute',
      resource: RESOURCE,
      constraints: {
        model: 'model-a',
        tool_ids: ['weather.tool.v1'],
        provider_ids: ['openweather'],
        run_id: 'run-1',
        max_credits: 10,
      },
      ...overrides,
    }),
    { status: 200, ...init, headers },
  );
}

function provider(fetchImpl: typeof fetch, subject?: CredentialProvider): AgentDelegationCredentialProvider {
  return new AgentDelegationCredentialProvider({
    tokenEndpoint: TOKEN_ENDPOINT,
    clientId: CLIENT_ID,
    clientSecret: CLIENT_SECRET,
    subjectCredentialProvider: subject ?? {
      async getCredential() {
        return SUBJECT_TOKEN;
      },
    },
    resource: RESOURCE,
    scopes: ['tools.inspect', 'tools.execute'],
    constraints: {
      model: 'model-a',
      toolIds: ['weather.tool.v1'],
      providerIds: ['openweather'],
      runId: 'run-1',
      maxCredits: 25,
    },
    fetch: fetchImpl,
  });
}

describe('AgentDelegationCredentialProvider', () => {
  it('validates credentials, endpoints, scopes, constraints, and cache settings', () => {
    expect(() => new ApiKeyCredentialProvider('')).toThrow(/required/);
    const options = {
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      subjectCredentialProvider: { getCredential: async () => SUBJECT_TOKEN },
      resource: RESOURCE,
      scopes: ['tools.execute'],
      fetch: vi.fn<typeof fetch>(),
    };
    const invalid = [
      { tokenEndpoint: 'not-a-url' },
      { tokenEndpoint: 'https://user:secret@qveris.ai/token' },
      { tokenEndpoint: 'https://qveris.ai/token?query=1' },
      { resource: 'ftp://api.qveris.ai/tools' },
      { clientSecret: 'bad\nsecret' },
      { subjectCredentialProvider: null },
      { scopes: [] },
      { scopes: ['bad scope'] },
      { scopes: 'tools.execute' },
      { expirySkewSeconds: 600 },
      { constraints: { model: '' } },
      { constraints: { runId: 'x'.repeat(129) } },
      { constraints: { toolIds: [] } },
      { constraints: { providerIds: Array.from({ length: 101 }, (_, index) => `p-${index}`) } },
      { constraints: { maxCredits: 0 } },
    ];
    for (const override of invalid) {
      expect(() => new AgentDelegationCredentialProvider({ ...options, ...override } as never)).toThrow(
        AgentDelegationError,
      );
    }

    const originalFetch = globalThis.fetch;
    vi.stubGlobal('fetch', undefined);
    expect(() => new AgentDelegationCredentialProvider({ ...options, fetch: undefined })).toThrow(AgentDelegationError);
    vi.stubGlobal('fetch', originalFetch);
  });

  it('rejects insecure remote token endpoints and invalid exchange timeouts', () => {
    const options = {
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      subjectCredentialProvider: { getCredential: async () => SUBJECT_TOKEN },
      resource: RESOURCE,
      scopes: ['tools.execute'],
      fetch: vi.fn<typeof fetch>(),
    };
    expect(
      () => new AgentDelegationCredentialProvider({ ...options, tokenEndpoint: 'http://remote.example/token' }),
    ).toThrow(AgentDelegationError);
    expect(() => new AgentDelegationCredentialProvider({ ...options, exchangeTimeoutMs: 0 })).toThrow(
      AgentDelegationError,
    );
  });

  it('performs one RFC 8693 exchange and coalesces concurrent callers', async () => {
    const contexts: CredentialContext[] = [];
    const subject: CredentialProvider = {
      async getCredential(context) {
        contexts.push(context);
        return SUBJECT_TOKEN;
      },
    };
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      expect(init?.method).toBe('POST');
      expect(init?.redirect).toBe('error');
      expect(init?.headers).toMatchObject({
        Authorization: `Basic ${Buffer.from('agent+runtime%3Aid:synthetic%3A+client%2Bsecret').toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      });
      const form = new URLSearchParams(String(init?.body));
      expect(form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:token-exchange');
      expect(form.get('subject_token')).toBe(SUBJECT_TOKEN);
      expect(form.get('resource')).toBe(RESOURCE);
      expect(form.get('scope')).toBe('tools.execute tools.inspect');
      expect(form.getAll('tool_ids')).toEqual(['weather.tool.v1']);
      expect(form.getAll('provider_ids')).toEqual(['openweather']);
      expect(form.get('model')).toBe('model-a');
      expect(form.get('run_id')).toBe('run-1');
      expect(form.get('max_credits')).toBe('25');
      await Promise.resolve();
      return tokenResponse();
    });

    const delegated = provider(fetchImpl, subject);
    const tokens = await Promise.all(Array.from({ length: 20 }, () => delegated.getCredential(CONTEXT)));

    expect(tokens).toEqual(Array.from({ length: 20 }, () => DELEGATION_TOKEN));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(contexts).toEqual([CONTEXT]);
    expect(await delegated.getCredential(CONTEXT)).toBe(DELEGATION_TOKEN);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('keeps the exchange timeout active while reading the response body', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (_input, init) => {
      const signal = init?.signal;
      return {
        headers: new Headers(),
        text: () =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('synthetic stalled body')), { once: true });
          }),
      } as Response;
    });
    const delegated = new AgentDelegationCredentialProvider({
      tokenEndpoint: TOKEN_ENDPOINT,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      subjectCredentialProvider: { getCredential: async () => SUBJECT_TOKEN },
      resource: RESOURCE,
      scopes: ['tools.execute'],
      fetch: fetchImpl,
      exchangeTimeoutMs: 5,
    });

    await expect(delegated.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'token_exchange_failed' });
  });

  it('does not reuse a token after clear', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => tokenResponse());
    const delegated = provider(fetchImpl);

    await delegated.getCredential(CONTEXT);
    delegated.clear();
    await delegated.getCredential(CONTEXT);

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('maps subject, transport, size, and JSON failures to safe errors', async () => {
    const subjectFailure = provider(vi.fn<typeof fetch>(), {
      getCredential: async () => {
        throw new Error('synthetic subject failure');
      },
    });
    await expect(subjectFailure.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'subject_credential_failed' });

    const transportFailure = provider(
      vi.fn<typeof fetch>(async () => {
        throw new Error('synthetic transport failure');
      }),
    );
    await expect(transportFailure.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'token_exchange_failed' });

    const declaredOversize = provider(
      vi.fn<typeof fetch>(async () => tokenResponse({}, { headers: { 'content-length': String(64 * 1024 + 1) } })),
    );
    await expect(declaredOversize.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });

    const actualOversize = provider(
      vi.fn<typeof fetch>(async () => new Response('x'.repeat(64 * 1024 + 1), { status: 200 })),
    );
    await expect(actualOversize.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });

    const invalidJson = provider(vi.fn<typeof fetch>(async () => new Response('not json', { status: 200 })));
    await expect(invalidJson.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });
  });

  it.each([
    ['shape', null],
    ['access token', { access_token: '' }],
    ['token type', { token_type: 'Basic' }],
    ['lifetime', { expires_in: 601 }],
    ['resource', { resource: 'https://wrong.example' }],
    ['scope widening', { scope: 'tools.execute admin' }],
    ['model constraint', { constraints: { model: 'other' } }],
    ['list constraint shape', { constraints: { model: 'model-a', tool_ids: 'bad', run_id: 'run-1', max_credits: 10 } }],
    [
      'provider constraint widening',
      {
        constraints: {
          model: 'model-a',
          tool_ids: ['weather.tool.v1'],
          provider_ids: ['openweather', 'other'],
          run_id: 'run-1',
          max_credits: 10,
        },
      },
    ],
  ])('rejects invalid token response: %s', async (_name, override) => {
    const response =
      override === null ? new Response('null', { status: 200 }) : tokenResponse(override as Record<string, unknown>);
    await expect(provider(vi.fn<typeof fetch>(async () => response)).getCredential(CONTEXT)).rejects.toMatchObject({
      code: 'invalid_token_response',
    });
  });

  it('rejects a token whose narrowed scope does not cover the current request', async () => {
    const delegated = provider(vi.fn<typeof fetch>(async () => tokenResponse({ scope: 'tools.inspect' })));
    await expect(delegated.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });
  });

  it('fails closed before exchange for audience or scope mismatches', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const delegated = provider(fetchImpl);

    await expect(delegated.getCredential({ ...CONTEXT, audience: 'https://wrong.example' })).rejects.toMatchObject({
      code: 'context_mismatch',
    });
    await expect(delegated.getCredential({ ...CONTEXT, scopes: ['admin'] })).rejects.toMatchObject({
      code: 'context_mismatch',
    });
    await expect(delegated.getCredential({ ...CONTEXT, audience: undefined })).rejects.toMatchObject({
      code: 'context_mismatch',
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await expect(resolveCredential(delegated, { ...CONTEXT, audience: 'https://wrong.example' })).rejects.toMatchObject(
      { code: 'context_mismatch' },
    );
  });

  it('rejects refresh tokens and widened response constraints', async () => {
    const withRefresh = provider(vi.fn<typeof fetch>(async () => tokenResponse({ refresh_token: 'forbidden' })));
    await expect(withRefresh.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });

    const widened = provider(
      vi.fn<typeof fetch>(async () =>
        tokenResponse({
          constraints: {
            model: 'model-a',
            tool_ids: ['weather.tool.v1', 'other.tool.v1'],
            run_id: 'run-1',
            max_credits: 30,
          },
        }),
      ),
    );
    await expect(widened.getCredential(CONTEXT)).rejects.toMatchObject({ code: 'invalid_token_response' });
  });

  it('returns bounded credential-safe errors without response or secret material', async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            error: 'invalid_client',
            error_description: `${CLIENT_SECRET} ${SUBJECT_TOKEN}`,
          }),
          { status: 401 },
        ),
    );
    const delegated = provider(fetchImpl);

    const error = await delegated.getCredential(CONTEXT).catch((value: unknown) => value);
    expect(error).toBeInstanceOf(AgentDelegationError);
    expect(error).toMatchObject({ code: 'token_exchange_failed', status: 401 });
    const serialized = JSON.stringify(error) + String(error);
    expect(serialized).not.toContain(CLIENT_SECRET);
    expect(serialized).not.toContain(SUBJECT_TOKEN);
  });
});
