# @qverisai/sdk

TypeScript SDK for [QVeris](https://qveris.ai) — the Agent External Data & Tool Harness. Discover, inspect and call 1000+ ranked external data & tool capabilities with unified billing and usage audit. No per-provider API keys required.

- **Typed end to end** — response types aligned with the public OpenAPI contract (categories, capabilities, `why_recommended`, `expected_cost`, billing)
- **Zero dependencies** — native `fetch`, Node.js 18+
- **Same wire semantics** as the [Python SDK](https://pypi.org/project/qveris/) and the [MCP server](https://www.npmjs.com/package/@qverisai/mcp)

## Install

```bash
npm install @qverisai/sdk
```

## Quickstart

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
// or: const qveris = Qveris.fromEnv();

// 1. Discover — free, returns ranked capabilities
const found = await qveris.discover('stock price market data API', { limit: 5 });
for (const tool of found.results) {
  console.log(tool.tool_id, '—', tool.why_recommended);
}

// 2. Inspect — free, current parameter schemas
const detail = await qveris.inspect(found.results[0].tool_id, {
  searchId: found.search_id,
});

// 3. Call — billed in credits; response includes pre-settlement billing
const outcome = await qveris.call(found.results[0].tool_id, {
  searchId: found.search_id,
  parameters: { symbol: 'AAPL' },
});
console.log(outcome.success, outcome.result);
```

## Audit

```typescript
// Final charge status for an execution
const usage = await qveris.usage({ execution_id: outcome.execution_id });

// Credit balance movements
const ledger = await qveris.ledger({ direction: 'consume', summary: true });

// Current balance
const credits = await qveris.credits();
```

## Configuration

| Option / env var | Description |
| --- | --- |
| `apiKey` / `QVERIS_API_KEY` | Required. Create one at [qveris.ai](https://qveris.ai/account?page=api-keys) (global) or [qveris.cn](https://qveris.cn/account?page=api-keys) (China) |
| `baseUrl` / `QVERIS_BASE_URL` | Override API base URL (highest priority) |
| `QVERIS_REGION` | Force region: `global` or `cn`. Otherwise auto-detected from the key prefix (`sk-cn-…` → China) |
| `timeoutMs` | Default request timeout (30s; `call` defaults to 120s) |

## Errors

All failures throw `QverisApiError` (an `Error` subclass) with `status`, `details`, and an `observability` object (operation, endpoint, request id) for diagnostics:

```typescript
import { QverisApiError } from '@qverisai/sdk';

try {
  await qveris.call('some.tool.v1', { parameters: {} });
} catch (err) {
  if (err instanceof QverisApiError && err.status === 402) {
    // insufficient credits — err.message includes the purchase link
  }
}
```

## Framework integrations

Expose the QVeris workflow as [Vercel AI SDK](https://sdk.vercel.ai) tools. `ai` and `zod` are peer dependencies:

```bash
npm install @qverisai/sdk ai zod
```

```typescript
import { generateText } from 'ai';
import { Qveris } from '@qverisai/sdk';
import { getQverisTools } from '@qverisai/sdk/ai';

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
const { text } = await generateText({
  model,
  tools: getQverisTools(qveris), // qveris_discover / qveris_inspect / qveris_call
  maxSteps: 6,
  prompt: 'Find a stock quote capability and quote AAPL.',
});
```

## Version history note

Versions `0.1.x` of this npm package were an early MCP-focused SDK, since superseded by [`@qverisai/mcp`](https://www.npmjs.com/package/@qverisai/mcp). The typed REST client documented here starts at **`0.2.0`**.

## Related

- [QVeris CLI](https://www.npmjs.com/package/@qverisai/cli) — `qveris discover / inspect / call / usage / ledger`
- [QVeris MCP server](https://www.npmjs.com/package/@qverisai/mcp) — for Claude, Cursor and other MCP clients
- [Python SDK](https://pypi.org/project/qveris/)
- [REST API docs](https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/en-US/rest-api.md)

## License

MIT
