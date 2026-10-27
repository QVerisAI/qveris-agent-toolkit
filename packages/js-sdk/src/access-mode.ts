/** Local access policy; public HTTP contracts are supplied separately. */
export type ClientAccessMode = 'authenticated' | 'public-read-only';
const AUTHENTICATION_HEADERS = new Set([
  'authorization',
  'cookie',
  'mcp-session-id',
  'x-qveris-trial-session-token',
  'x-qveris-claim-account-token',
  'x-qveris-trial-csrf',
  'x-qveris-hosted-mcp-context',
  'x-qveris-hosted-mcp-signature',
  'x-qveris-credential-context',
  'x-qveris-credential-signature',
]);

export interface AuthenticationProofPresence {
  readonly headers?: ConstructorParameters<typeof Headers>[0];
  readonly hasSessionProof?: boolean;
}

export function resolveAccessMode(
  publicReadOnly: boolean = false,
  hasCredentials: boolean = false,
  proofs: AuthenticationProofPresence = {},
): ClientAccessMode {
  if (typeof publicReadOnly !== 'boolean') {
    throw new Error('Public read-only access requires an explicit boolean option.');
  }
  if (!publicReadOnly) return 'authenticated';
  if (hasCredentials || proofs.hasSessionProof || hasAuthenticationHeader(proofs.headers)) {
    throw new Error('Public read-only mode cannot be combined with credentials.');
  }
  return 'public-read-only';
}

function hasAuthenticationHeader(headers?: ConstructorParameters<typeof Headers>[0]): boolean {
  if (!headers) return false;
  const names =
    headers instanceof Headers
      ? [...headers.keys()]
      : Array.isArray(headers)
        ? headers.map(([name]) => name)
        : Object.keys(headers);
  return names.some((name) => AUTHENTICATION_HEADERS.has(name.toLowerCase()));
}

export function assertOperationAccess(mode: ClientAccessMode, operation: string): void {
  if (mode === 'public-read-only' && operation !== 'discover' && operation !== 'inspect') {
    throw new Error(
      'Public read-only mode only supports Discover and Inspect. Authenticate and refresh discovery first.',
    );
  }
}
