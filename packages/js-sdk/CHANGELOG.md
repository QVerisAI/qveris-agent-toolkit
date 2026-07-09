# Changelog

All notable changes to `@qverisai/sdk` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.3.0] - 2026-07-09

### Added

- Vercel AI SDK adapter: `getQverisTools(qveris)` from `@qverisai/sdk/ai` returns `qveris_discover` / `qveris_inspect` / `qveris_call` tools for `generateText`/`streamText` (`ai` and `zod` as optional peer dependencies). ([#134])
- Rate-limited (`429`) and transient (`503`) responses are retried automatically: honors `Retry-After`, otherwise exponential backoff with jitter, bounded by the `maxRetries` config option (default 3; `0` disables); `rateLimitRetryCount` exposes the backoff. ([#143])

## [0.2.0] - 2026-07-06

### Added

- First release of the typed QVeris REST client: `discover` / `inspect` / `call` / `credits` / `usage` / `ledger`, zero dependencies (native fetch, Node 18+). ([#106])
- Wire semantics aligned with the Python SDK and MCP server: success-envelope unwrapping, region auto-detection from the key prefix, structured `QverisApiError` with observability context.
- Response types cover category objects, capability descriptors, `why_recommended`, and `expected_cost`.

### Note

- `0.1.x` under this npm name was an early MCP-focused SDK, superseded by `@qverisai/mcp`.

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/js-sdk-v0.3.0...HEAD
[0.3.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/js-sdk-v0.2.0...js-sdk-v0.3.0
[0.2.0]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/js-sdk-v0.2.0
[#143]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/143
[#134]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/134
[#106]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/106
