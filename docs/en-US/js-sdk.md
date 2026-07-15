# QVeris TypeScript SDK

Typed TypeScript/JavaScript SDK to discover, inspect, call, and audit 10,000+ real-world API capabilities from your own agents and applications.

`@qverisai/sdk` v0.4.0 is the latest tested release. It is a thin, typed wrapper over the QVeris REST API (`discover`, `inspect`, `call`, `credits`, `usage`, `ledger`). It has **zero runtime dependencies** — it uses the platform `fetch` (Node.js 18+) — and mirrors the wire semantics of the [Python SDK](python-sdk.md) and the [MCP server](mcp-server.md).

## Installation

```bash
npm install @qverisai/sdk
```

Requires Node.js 18+ (native `fetch`). The package is ESM-only.

## Authentication

The SDK reads your API key from the `QVERIS_API_KEY` environment variable:

```bash
export QVERIS_API_KEY="sk-..."
```

Create a key in [Dashboard / API Keys](/account?page=api-keys). Create the client from the environment, or pass configuration explicitly:

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();
// or
const explicit = new Qveris({ apiKey: 'sk-...' });
```

Endpoint priority is explicit `baseUrl` > `QVERIS_BASE_URL` > the built-in default. API keys never select the endpoint. To target a custom endpoint, pass `baseUrl` explicitly or set `QVERIS_BASE_URL`:

```typescript
const client = new Qveris({ apiKey: 'sk-...', baseUrl: 'https://qveris.ai/api/v1' });
```

## Quickstart

The core workflow is **discover → inspect → call**, then optionally **audit** what happened. All methods return promises.

```typescript
import { Qveris } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();

// 1. Discover capabilities with natural language (free)
const discovered = await qveris.discover('weather forecast API', { limit: 5 });
const tool = discovered.results[0];

// 2. Inspect the selected capability for full parameters
const inspected = await qveris.inspect(tool.tool_id, { searchId: discovered.search_id });
const selected = inspected.results[0];

// 3. Call it (may consume credits)
const params = selected.examples?.sample_parameters ?? { city: 'London' };
const result = await qveris.call(selected.tool_id, {
  parameters: params,
  searchId: discovered.search_id,
  maxResponseSize: 20480,
});
console.log(result.success, result.result);

// 4. Audit the final charge outcome
const usage = await qveris.usage({ execution_id: result.execution_id, summary: true });
const ledger = await qveris.ledger({ summary: true, limit: 5 });
console.log(usage.total, ledger.total);
```

There is no connection to close — the client is stateless over `fetch`.

## Configuration reference

`new Qveris(config)` accepts:

| Field | Env var | Default | Description |
|-------|---------|---------|-------------|
| `apiKey` | `QVERIS_API_KEY` | — (required) | API key, sent as `Authorization: Bearer ...` |
| `baseUrl` | `QVERIS_BASE_URL` | `https://qveris.ai/api/v1` | API base URL; constructor option has highest priority |
| `timeoutMs` | — | `30000` | Default request timeout (`call` defaults to `120000`) |

`Qveris.fromEnv(overrides?)` builds the client from `QVERIS_API_KEY` and accepts the same non-key options.

## API reference

The [source-generated symbol reference](js-sdk-api.md) lists every public
class, method, option, response type, and AI SDK integration exported by the
current package. It is regenerated from TypeScript source and checked for drift
in CI.

### `Qveris`

| Method | REST endpoint | Purpose |
|--------|---------------|---------|
| `discover(query, options?)` | `POST /search` | Find capabilities with natural language (free) |
| `inspect(toolIds, options?)` | `POST /tools/by-ids` | Fetch full capability metadata (free) |
| `call(toolId, options)` | `POST /tools/execute` | Execute a capability (may consume credits) |
| `credits()` | `GET /auth/credits` | Current credit balance and buckets |
| `usage(filters?)` | `GET /auth/usage/history/v2` | Audit request status and charge outcome |
| `ledger(filters?)` | `GET /auth/credits/ledger` | Inspect final credit balance movements |

Option shapes:

- `discover(query, { limit?, sessionId?, timeoutMs? })`
- `inspect(toolIds, { searchId?, sessionId?, timeoutMs? })` — `toolIds` accepts a single string or an array; an **empty array short-circuits** and returns an empty response without a network request.
- `call(toolId, { parameters, searchId?, sessionId?, maxResponseSize?, timeoutMs? })`

`usage(...)` and `ledger(...)` take filter objects such as `start_date`, `end_date`, `summary`, `bucket`, `charge_outcome`, `execution_id`, `search_id`, `direction`, `entry_type`, `min_credits`, `max_credits`, `limit`, `page`, `page_size`.

## Typed responses

All methods return typed results that track the public OpenAPI contract. Unknown backend fields pass through, so newer API metadata will not break older SDK clients.

- Discover / inspect: `SearchResponse` → `results: ToolInfo[]`; `ToolInfo` has `tool_id`, `name`, `description`, `categories` (objects or strings), `capabilities`, `params`, `examples`, `stats`, `billing_rule`, `expected_cost`, and (discover only) `why_recommended`.
- Call: `ExecuteResponse` with `execution_id`, `success`, `result`, `error_message`, `billing` (`CompactBillingStatement`), `cost`, `remaining_credits`.
- Usage audit: `UsageEventsResponse` → `items: UsageEventItem[]`, `total`, `summary`.
- Credits ledger: `CreditsLedgerResponse` → `items: CreditsLedgerItem[]`, `total`, `summary`.

```typescript
import type { ExecuteResponse } from '@qverisai/sdk';

function explain(result: ExecuteResponse): string {
  if (!result.success) return `failed: ${result.error_message}`;
  const charged = result.billing?.summary ?? 'no billing info';
  return `ok (${charged}); remaining=${result.remaining_credits}`;
}
```

## Bring your own agent loop

The typed client is a natural tool backend for any LLM agent framework: expose `discover` / `inspect` / `call` as tools to your model, then route the tool calls back through the client. Because `discover` returns `why_recommended` and `expected_cost`, your agent can rank and budget capabilities before calling them.

## Framework integrations

### Vercel AI SDK

Expose the QVeris workflow as [Vercel AI SDK](https://sdk.vercel.ai) tools. `ai` and `zod` are peer dependencies (import from the `@qverisai/sdk/ai` subpath):

```bash
npm install @qverisai/sdk ai zod
```

```typescript
import { generateText } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Qveris } from '@qverisai/sdk';
import { getQverisTools } from '@qverisai/sdk/ai';

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
const { text } = await generateText({
  model: openai('gpt-4o'),
  tools: getQverisTools(qveris), // qveris_discover / qveris_inspect / qveris_call
  maxSteps: 6,
  prompt: 'Find a stock quote capability and quote AAPL.',
});
```

The [Python SDK](python-sdk.md) ships LangChain and OpenAI Agents SDK adapters as well.

## Error handling

Every failed request throws `QverisApiError` — an `Error` subclass carrying:

| Property | Description |
|----------|-------------|
| `status` | HTTP status (`0` network error, `408` timeout, `402` insufficient credits, …) |
| `details` | The server-returned error body, when available |
| `observability` | Request context (operation, endpoint, request id) for diagnostics |
| `cause` | Lower-level transport/runtime cause, when available |

```typescript
import { Qveris, QverisApiError } from '@qverisai/sdk';

const qveris = Qveris.fromEnv();
try {
  await qveris.call('some.tool.v1', { parameters: {} });
} catch (err) {
  if (err instanceof QverisApiError && err.status === 402) {
    // insufficient credits — err.message includes the purchase link
  }
}
```

`result.success` reflects the capability call only. **Do not** treat it as the final billing outcome — confirm charges with `usage(...)` / `ledger(...)`.

## Compatibility

- Node.js `>=18` (native `fetch`). ESM-only.
- Response types and public methods follow additive compatibility where possible.
- Breaking changes require a major version bump and migration notes.

> Versions `0.1.x` of the `@qverisai/sdk` npm package were an early MCP-focused SDK, since superseded by [`@qverisai/mcp`](mcp-server.md). The typed REST client documented here starts at **`0.2.0`**.

## Links

- Package: [`@qverisai/sdk` on npm](https://www.npmjs.com/package/@qverisai/sdk)
- Source: [`packages/js-sdk`](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/js-sdk)
- REST API: [rest-api.md](rest-api.md)
- Get an API key: [Dashboard / API Keys](/account?page=api-keys)
