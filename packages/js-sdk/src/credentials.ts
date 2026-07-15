/** Context supplied whenever the client requests a credential. */
export interface CredentialContext {
  /** API resource the credential will be sent to. */
  resource: string;

  /** Requested authorization scopes. Empty until a public scope contract is available. */
  scopes: readonly string[];
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

/** Resolve and validate a provider value without exposing it in errors. */
export async function resolveCredential(provider: CredentialProvider, context: CredentialContext): Promise<string> {
  let credential: string;
  try {
    credential = await provider.getCredential(context);
  } catch {
    throw new Error('QVeris credential provider failed to provide a credential.');
  }
  if (typeof credential !== 'string' || !credential.trim() || /[\r\n]/.test(credential)) {
    throw new Error('QVeris credential provider returned an invalid credential.');
  }
  return credential.trim();
}
