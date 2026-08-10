import { Buffer } from 'node:buffer';

import { describe, expect, it, vi } from 'vitest';

import {
  AgentDelegationCredentialProvider,
  AgentDelegationError,
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

function tokenResponse(overrides: Record<string, unknown> = {}): Response {
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
        run_id: 'run-1',
        max_credits: 10,
      },
      ...overrides,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
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
      runId: 'run-1',
      maxCredits: 25,
    },
    fetch: fetchImpl,
  });
}

describe('AgentDelegationCredentialProvider', () => {
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
