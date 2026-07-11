# QVeris TypeScript SDK examples

Runnable examples for `@qverisai/sdk`. Each script is safe to run without an API
key — it prints how to set one and exits — so it also serves as a smoke test
that the SDK imports and wires up. Discovery and inspection are free; the `call`
step is additionally gated behind `RUN_QVERIS_CALLS=1` so no example spends
credits by accident.

## Run

```bash
export QVERIS_API_KEY="sk-..."          # https://qveris.ai/account?page=api-keys
npx tsx examples/quickstart.ts          # discover -> inspect -> audit (no charge)
RUN_QVERIS_CALLS=1 npx tsx examples/quickstart.ts   # also executes a capability
```

## Examples

| File                                                       | Shows                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [`quickstart.ts`](quickstart.ts)                           | The full discover → inspect → call → audit loop with routing signals             |
| [`vercel-ai-agent.ts`](vercel-ai-agent.ts)                 | Exposing QVeris as Vercel AI SDK tools so a model can find and call capabilities |
| [`retry-and-observability.ts`](retry-and-observability.ts) | Configuring rate-limit backoff and reading `rateLimitRetryCount`                 |

`_shared.ts` holds the tiny helpers (client bootstrap, the `RUN_QVERIS_CALLS`
gate) the examples share.

The Vercel AI example needs a model provider of your choice, e.g.
`npm i @ai-sdk/openai`; without one it prints the wired tool set instead of
driving a model.
