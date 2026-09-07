# Troubleshooting & FAQ

Common issues across the QVeris CLI, SDKs, and MCP server. See also the
per-surface docs in [`docs/en-US`](en-US) and the runnable
[examples](../packages/js-sdk/examples).

## Authentication

**`QVERIS_API_KEY is not set` / 401 / "API key is required".**
Create a key at [qveris.ai/account?page=api-keys](https://qveris.ai/account?page=api-keys), then export it:

```bash
export QVERIS_API_KEY="sk-..."
```

**Wrong API endpoint.**
Set `QVERIS_BASE_URL` to the complete API root supplied by the active deployment. The CLI also accepts `--base-url` for a one-command override.

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
Read-only operations may retry automatically: clients honor `Retry-After`, then
use bounded exponential backoff according to their retry configuration. A paid
`call` is strict single-submit and is not replayed automatically. If its HTTP
outcome is unknown, reconcile usage before deciding whether the user wants a
new attempt. If rate limits persist, lower concurrency.

## Discovery & calls

**`discover` returns no results.**
Describe the *capability* you need ("public company stock quote API"), not the
parameters you plan to pass. Broaden the query and raise `--limit` / `limit`.

**`call` returns `success: false` or invalid-parameter errors.**
Use the current parameter contract returned by `discover`; if the compact result
omitted it or it is stale, `inspect` promising candidates. Preserve required,
enum, and one-of constraints. `examples.sample_parameters` shows shape only —
derive business values from the current request. `error_message` explains the failure.

**Large responses look truncated.**
Responses are capped by `max_response_size` (`--max-size` in the CLI). The
default is 20480 bytes for `--json`/non-interactive use, but only 4096 bytes in
an interactive terminal — so a truncated result in a TTY is hitting the 4 KB
cap. Raise it (`-1` for unlimited) if you need the full payload.

## MCP server

**The client shows no QVeris tools.**
Tool *listing* works without a key; tool *calls* need `QVERIS_API_KEY` in the
server's env. Verify your config with `qveris mcp validate --target <client>`,
and regenerate it with `qveris mcp configure --target <client> --write`.

## Environment

**Node version errors.**
The packages require Node `>=18.2.0`. Check with `node -v`.
