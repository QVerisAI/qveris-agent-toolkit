# Changelog

All notable changes to `@qverisai/mcp` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The deprecated alias tools (`search_tools`, `get_tools_by_ids`, `execute_tool`) now declare the same `outputSchema` as their canonical counterparts, so MCP SDK clients validate alias results instead of silently skipping validation. Correction to the 0.9.0 notes: through 0.10.0 only the five canonical tools declared `outputSchema`, although alias calls always returned `structuredContent`. ([#237])

## [0.10.0] - 2026-07-14

### Changed

- Replaced legacy region and API-key-prefix routing with deterministic endpoint selection: `QVERIS_BASE_URL` overrides the built-in default, and endpoint overrides are validated before use. The official MCP Registry manifest now declares only `QVERIS_API_KEY` and the optional `QVERIS_BASE_URL`. ([#204])
- Upgraded the Vitest and coverage toolchain to audited Node.js 18-compatible releases and pinned the Vite 6 security floor used by tests. Published runtime dependencies are unchanged. ([#211])

## [0.9.0] - 2026-07-13

### Added

- An embedding API for independently operated Streamable HTTP services: asynchronous per-session server factories can require a caller bearer, receive it only during session construction, and rely on fingerprint binding to reject later credential changes. Credential validation and client policy stay outside the toolkit. ([#201])
- Fuller MCP spec surface ([#158]):
  - **Output schemas + structured content** — every tool declares `outputSchema` (loose, additive-friendly) and returns `structuredContent` alongside the JSON text, so clients consume typed results instead of re-parsing strings.
  - **Elicitation billing consent** — with `QVERIS_MCP_CONFIRM_CALLS=true` and an elicitation-capable client, a charged `call` asks the user to confirm first; declining cancels the call before any credits are spent. Off by default (headless agents unaffected); clients without elicitation proceed as before.
  - **Resources** — `qveris://server-card` (SEP-2127 card, also without a remote in stdio mode) and the `qveris://capability/{tool_id}` template serving full capability metadata, so users can browse/attach capability docs without a tool call.

### Changed

- Tool results and resource reads serialize as compact JSON instead of pretty-printed — indentation was ~35% of a `qveris_discover` payload in tokens, with no information loss. Matches the HTTP discovery endpoints, which were already compact. ([#120])

## [0.8.0] - 2026-07-09

### Added

- Streamable HTTP transport for remote MCP alongside the stdio default: per-session servers keyed by `Mcp-Session-Id`, optional inbound bearer auth (fail-closed on non-loopback binds), DNS-rebinding protection, request-body cap, and idle-session eviction. ([#139])
- Server Card (`GET {path}/server-card`) and MCP Catalog (`GET /.well-known/mcp/catalog.json`) discovery documents, so registries and crawlers can learn about the server without connecting. ([#140])
- Rate-limited (`429`) and transient (`503`) API responses are retried automatically: honors `Retry-After`, otherwise exponential backoff with jitter, bounded by `config.maxRetries` / `QVERIS_MAX_RETRIES` (default 3; `0` disables); `rateLimitRetryCount` exposes the backoff. ([#145])

### Changed

- Requires Node.js >= 18.2 (was >= 18.0): prompt HTTP-server shutdown uses `closeAllConnections`, added in 18.2. ([#139])

## [0.7.5] - 2026-07-07

### Fixed

- The server starts without `QVERIS_API_KEY`: MCP clients and registry scanners can list tools before credentials are configured; tool calls return an actionable error until a key is set. ([#126])

## [0.7.4] - 2026-07-07

### Fixed

- `mcpName` casing (`io.github.QVerisAI/mcp`) required by the official MCP Registry ownership validation. ([#122])

## [0.7.3] - 2026-07-06

### Added

- `ToolInfo` declares `capabilities`, `expected_cost`, `why_recommended`, and `provider_id`, matching current Discover/Inspect responses. ([#102])
- `mcpName` and MCP registry metadata (`server.json`, Smithery, Glama) for directory listings. ([#117])

### Removed

- `provider_logo_url` from type declarations (dropped from the public spec). ([#105])

## [0.7.2] - 2026-07-06

### Fixed

- Accept object-shaped tool categories in discover/inspect results (legacy string tags still supported). ([#97])
- Hardened MCP probe and call params/observability paths. ([#85])

## [0.7.1] - 2026-06-13

### Fixed

- Hardened process-entrypoint detection, including npm bin symlinks.

## [0.7.0] - 2026-05-21

### Added

- Generated OpenAPI contract types with drift CI. ([#48])
- Canonical qveris tool names standardized across surfaces. ([#31])

## [0.6.0] - 2026-05-06

### Added

- Context-safe `usage_history` and `credits_ledger` audit tools. ([#18])

## [0.5.0] - 2026-04-09

### Changed

- Tools renamed to `discover` / `inspect` / `call`; the previous names remain as deprecated aliases. ([#14])
- Multi-region (global/China) support improvements. ([#13])

## [0.4.0] - 2026-04-04

### Added

- China region (`qveris.cn`) support. ([#9])

### Changed

- Monorepo restructure. ([#8])

## [0.3.0] / [0.2.0] - 2026-04-04

- Version bumps / republish; no functional changes.

## [0.1.2] - 2026-04-04

### Fixed

- Handle empty/non-JSON success responses gracefully; `params_to_tool` documented as an object.

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.10.0...HEAD
[0.10.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.9.0...mcp-v0.10.0
[0.9.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.8.0...mcp-v0.9.0
[0.8.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.5...mcp-v0.8.0
[0.7.5]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.4...mcp-v0.7.5
[0.7.4]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.3...mcp-v0.7.4
[0.7.3]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.2...mcp-v0.7.3
[0.7.2]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.1...mcp-v0.7.2
[0.7.1]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.7.0...mcp-v0.7.1
[0.7.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.6.0...mcp-v0.7.0
[0.6.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.5.0...mcp-v0.6.0
[0.5.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.4.0...mcp-v0.5.0
[0.4.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.3.0...mcp-v0.4.0
[0.3.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.2.0...mcp-v0.3.0
[0.2.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/mcp-v0.1.2...mcp-v0.2.0
[0.1.2]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/mcp-v0.1.2
[#201]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/201
[#204]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/204
[#211]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/211
[#237]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/237
[#158]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/158
[#145]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/145
[#120]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/120
[#140]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/140
[#139]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/139
[#126]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/126
[#122]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/122
[#117]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/117
[#105]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/105
[#102]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/102
[#97]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/97
[#85]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/85
[#48]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/48
[#31]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/31
[#18]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/18
[#14]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/14
[#13]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/13
[#9]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/9
[#8]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/8
