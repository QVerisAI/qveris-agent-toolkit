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

// 3. Probe — zero-cost validation and quote; no capability execution
const probe = await qveris.probe(found.results[0].tool_id, {
  parameters: { symbol: 'AAPL' },
  checks: ['schema', 'quote'],
});

// 4. Call — billed in credits; response includes pre-settlement billing
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

## API reference

Construct with `new Qveris({ apiKey })` or `Qveris.fromEnv(overrides?)` (reads
`QVERIS_API_KEY` and resolves the API endpoint automatically). Applications
that manage short-lived credentials can instead pass an async-capable provider:

```typescript
import { Qveris, type CredentialProvider } from '@qverisai/sdk';

const credentialProvider: CredentialProvider = {
  async getCredential({ resource, scopes }) {
    // Resolve a bearer credential through your application's credential store.
    return process.env.QVERIS_API_KEY!;
  },
};

const qveris = new Qveris({ credentialProvider });
```

The provider receives the resolved API `resource` and the requested `scopes`
(currently empty). Configure either `apiKey` or `credentialProvider`, never
both. A provider does not select or change the API endpoint.

A credential provider supplies the bearer value that authenticates requests to
the QVeris API itself. It is unrelated to the data and tool providers in the
capability catalog: their upstream credentials are managed by the platform and
never pass through the SDK.

| Method | Billed | Returns | Notes |
| --- | --- | --- | --- |
| `discover(query, options?)` | Free | `SearchResponse` | `options`: `limit`, `sessionId`, `view`, `lang`, `timeoutMs`. `view: 'routing'` returns compact routing cards; omitted/default is full. |
| `inspect(toolIds, options?)` | Free | `SearchResponse` | `toolIds` is one id or an array; `options`: `searchId`, `sessionId`, `timeoutMs`. An empty array resolves locally with no request. |
| `call(toolId, options)` | Credits | `ExecuteResponse` | `options`: `parameters` (required), `searchId`, `maxResponseSize`, `respondWith`, `sessionId`, `timeoutMs`. `respondWith` accepts `full`, `summary`, or `fields:<JSONPath,...>`. |
| `credits()` | Free | `CreditsResponse` | Current balance and bucket details. |
| `usage(filters?)` | Free | `UsageEventsResponse` | Request-level audit; filter by `execution_id`, `search_id`, dates, `summary`, `limit`. |
| `ledger(filters?)` | Free | `CreditsLedgerResponse` | Settled credit movements; filter by `direction`, dates, `summary`, `limit`. |

Read-only members: `qveris.rateLimitRetryCount` (see [Rate limiting](#rate-limiting--retries)).

Key response fields:

- **`SearchResponse`** — `search_id`, `total`, `results: ToolInfo[]` (`tool_id`, `name`, `description`, `params`, `examples.sample_parameters`, `stats.success_rate`, `stats.avg_execution_time_ms`, `expected_cost`, `why_recommended`).
- **`ExecuteResponse`** — `execution_id`, `success`, `result`, `billing` (pre-settlement estimate; the final charge is in `usage()` / `ledger()`).

Projection options are never sent unless explicitly configured. If a legacy service returns `422 extra_forbidden` for an optional projection field, the SDK retries once without that field; validation errors for an invalid projection are returned unchanged.

All types are exported from the package root (`import type { SearchResponse, ExecuteResponse, ToolInfo } from '@qverisai/sdk'`).

## Configuration

| Option / env var | Description |
| --- | --- |
| `apiKey` / `QVERIS_API_KEY` | Required. Create one at [qveris.ai](https://qveris.ai/account?page=api-keys) |
| `credentialProvider` | Async-capable bearer credential source; mutually exclusive with `apiKey` |
| `baseUrl` / `QVERIS_BASE_URL` | API endpoint: constructor option > environment variable > built-in default |
| `timeoutMs` | Default request timeout (30s; `call` defaults to 120s) |
| `maxRetries` | Retries for rate-limited (429) / transient (503) responses (default 3; `0` disables) |

API keys never select the endpoint. Endpoint overrides must be HTTP(S) URLs without credentials, a query string, or a fragment.

## Rate limiting & retries

The client transparently retries rate-limited (`429`) and transient (`503`) responses: it honors the `Retry-After` header when present, otherwise backs off exponentially with full jitter. Each wait is capped and retries are bounded by `maxRetries`, so a call never hangs.

```ts
const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY!, maxRetries: 5 });
// ... after some calls under load:
qveris.rateLimitRetryCount; // how many times it backed off (pressure, not failures)
```

Set `maxRetries: 0` to disable. Rate-limit backoff is retried pressure rather than failure — read `rateLimitRetryCount` to observe it instead of treating the retried `429`s as errors.

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
import { generateText, stepCountIs } from 'ai';
import { openai } from '@ai-sdk/openai';
import { Qveris } from '@qverisai/sdk';
import { getQverisTools } from '@qverisai/sdk/ai';

const qveris = new Qveris({ apiKey: process.env.QVERIS_API_KEY! });
const { text } = await generateText({
  model: openai('gpt-4o'),
  tools: getQverisTools(qveris), // qveris_discover / qveris_inspect / qveris_call
  stopWhen: stepCountIs(6),
  prompt: 'Find a stock quote capability and quote AAPL.',
});
```

## Examples

Runnable scripts in [`examples/`](examples): the discover → inspect → call
quickstart, a Vercel AI SDK agent, and rate-limit/observability. Each is safe to
run without an API key (it explains how to set one), and any credit-spending
call is gated behind `RUN_QVERIS_CALLS=1`.

## Version history note

Versions `0.1.x` of this npm package were an early MCP-focused SDK, since superseded by [`@qverisai/mcp`](https://www.npmjs.com/package/@qverisai/mcp). The typed REST client documented here starts at **`0.2.0`**.

## Related

- [QVeris CLI](https://www.npmjs.com/package/@qverisai/cli) — `qveris discover / inspect / call / usage / ledger`
- [QVeris MCP server](https://www.npmjs.com/package/@qverisai/mcp) — for Claude, Cursor and other MCP clients
- [Python SDK](https://pypi.org/project/qveris/)
- [REST API docs](https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/en-US/rest-api.md)

## License

MIT
