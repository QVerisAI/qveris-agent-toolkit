/**
 * QVeris TypeScript SDK.
 *
 * Typed client for the QVeris Agent External Data & Tool Harness:
 * discover, inspect, call, plus usage and credits-ledger audit.
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
export type { DiscoverOptions, InspectOptions, CallOptions, QverisClientOptions } from './client.js';
export { ApiKeyCredentialProvider } from './credentials.js';
export type { CredentialContext, CredentialProvider } from './credentials.js';
export { QverisApiError } from './errors.js';
export * from './types.js';
