import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

// A disconnected HTTP response does not mean its provider operation finished.
const operations = new WeakMap<Server, Set<Promise<unknown>>>();

export async function trackOperation<T>(server: Server, run: () => Promise<T>): Promise<T> {
  let pending = operations.get(server);
  if (!pending) {
    pending = new Set();
    operations.set(server, pending);
  }
  const operation = Promise.resolve().then(run);
  pending.add(operation);
  try {
    return await operation;
  } finally {
    pending.delete(operation);
  }
}

export async function waitForOperations(server: Server): Promise<void> {
  const pending = operations.get(server);
  while (pending?.size) await Promise.allSettled([...pending]);
}
