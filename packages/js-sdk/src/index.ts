/**
 * QVeris TypeScript SDK.
 *
 * Typed client for the QVeris Agent External Data & Tool Harness:
 * discover, inspect, probe, call, plus usage and credits-ledger audit.
 *
 * @example
 * ```typescript
 * import { Qveris } from '@qverisai/sdk';
 *
 * const qveris = Qveris.fromEnv();
 * const found = await qveris.discover('weather forecast API');
 * ```
 *
 * @module @qverisai/sdk
 */

export { Qveris } from './client.js';
export type { DiscoverOptions, InspectOptions, ProbeOptions, CallOptions, QverisClientOptions } from './client.js';
export { AgentDelegationCredentialProvider, AgentDelegationError, ApiKeyCredentialProvider } from './credentials.js';
export type {
  AgentDelegationConstraints,
  AgentDelegationCredentialProviderOptions,
  AgentDelegationErrorCode,
  CredentialContext,
  CredentialProvider,
  CredentialPurpose,
} from './credentials.js';
export { QverisApiError } from './errors.js';
export * from './types.js';
