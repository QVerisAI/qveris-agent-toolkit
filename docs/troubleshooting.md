# Troubleshooting & FAQ

Common issues across the QVeris CLI, SDKs, and MCP server. See also the
per-surface docs in [`docs/en-US`](en-US) and the runnable
[examples](../packages/js-sdk/examples).

## Authentication

**`QVERIS_API_KEY is not set` / 401 / "API key is required".**
Create a key at [qveris.ai/account?page=api-keys](https://qveris.ai/account?page=api-keys)
(global) or [qveris.cn/account?page=api-keys](https://qveris.cn/account?page=api-keys)
(China), then export it:

```bash
export QVERIS_API_KEY="sk-..."
```

**Wrong region / cross-region key errors.**
The region is auto-detected from the key prefix (`sk-cn-…` → China, otherwise
global). Override with `QVERIS_REGION=global|cn` or `QVERIS_BASE_URL`. A global
key will not work against `qveris.cn` and vice versa.

## Billing

**402 / "insufficient credits".**
Discovery and inspection are free; `call` spends credits. The free tier includes
1,000 credits. The error message includes the top-up link. Check your balance
with `qveris credits` or `qveris.credits()`.

**The pre-call estimate and the final charge differ.**
The `call` response carries a *pre-settlement* `billing` estimate. The final,
settled charge is in `qveris usage --mode search --execution-id <id>` (CLI) or
`usage()` / `ledger()` (SDK).

## Rate limits

**429 / "rate limited".**
The CLI, SDKs, and MCP server retry automatically: they honor `Retry-After`,
otherwise back off exponentially with jitter, bounded by `maxRetries`
(constructor option in the SDKs) / `QVERIS_MAX_RETRIES` (CLI, default 3; `0`
disables). Backoff is *pressure*, not failure — the JS SDK exposes
`rateLimitRetryCount`. If you still hit limits, lower concurrency.

## Discovery & calls

**`discover` returns no results.**
Describe the *capability* you need ("public company stock quote API"), not the
parameters you plan to pass. Broaden the query and raise `--limit` / `limit`.

**`call` returns `success: false` or invalid-parameter errors.**
`inspect` the tool first and pass exactly the parameters its schema declares;
`examples.sample_parameters` shows a working shape. `error_message` explains the
failure.

**Large responses look truncated.**
Responses are capped by `max_response_size` (`--max-size` in the CLI, default
20480 bytes; `-1` for unlimited). Raise it if you need the full payload.

## MCP server

**The client shows no QVeris tools.**
Tool *listing* works without a key; tool *calls* need `QVERIS_API_KEY` in the
server's env. Verify your config with `qveris mcp validate --target <client>`,
and regenerate it with `qveris mcp configure --target <client> --write`.

## Environment

**Node version errors.**
The packages require Node `>=18.2.0` (see `.nvmrc`). Check with `node -v`.
