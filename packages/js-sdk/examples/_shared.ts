/**
 * Shared helpers for the QVeris TypeScript SDK examples.
 *
 * Every example is safe to run without an API key: it prints how to set one
 * and returns instead of failing. Discovery and inspection are free; an actual
 * `call` (which may consume credits) is additionally gated behind
 * `RUN_QVERIS_CALLS=1` so running an example never spends credits by accident.
 */

import { Qveris, type ToolInfo } from '@qverisai/sdk';

/**
 * Build a client from `QVERIS_API_KEY`, or explain how to set one and return
 * `null`. Examples call this first and bail out cleanly when unconfigured, so
 * they double as a smoke test that the SDK imports and wires up correctly.
 */
export function getClientOrExplain(): Qveris | null {
  if (!process.env.QVERIS_API_KEY) {
    console.log('Set QVERIS_API_KEY to run this example against the QVeris API.');
    console.log('  Global: https://qveris.ai/account?page=api-keys');
    console.log('  China:  https://qveris.cn/account?page=api-keys');
    return null;
  }
  return Qveris.fromEnv();
}

/** A `call` spends credits, so only execute one when explicitly opted in. */
export function shouldCall(): boolean {
  return process.env.RUN_QVERIS_CALLS === '1';
}

/** Prefer the capability's own sample parameters; fall back to a sensible default. */
export function sampleParameters(tool: ToolInfo, fallback: Record<string, unknown>): Record<string, unknown> {
  return tool.examples?.sample_parameters ?? fallback;
}
