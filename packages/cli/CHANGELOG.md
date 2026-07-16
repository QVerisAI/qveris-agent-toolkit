# Changelog

All notable changes to `@qverisai/cli` are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.1] - 2026-07-15

### Fixed

- Account and pricing recovery hints now follow the resolved API endpoint for the public sites and custom deployments instead of linking to an unrelated site. ([#221])

### Changed

- Routed authenticated requests through an internal credential-provider boundary while preserving all existing API-key resolution and endpoint-selection behavior. ([#226])

## [0.8.0] - 2026-07-14

### Changed

- Replaced legacy region and API-key-prefix routing with deterministic endpoint selection: `--base-url` overrides `QVERIS_BASE_URL`, which overrides the built-in default. Invalid URLs fail before network access, and public CLI output no longer exposes deployment-routing controls. ([#204])
- Raised `engines.node` to `>=18.2.0`, aligning every package on the toolkit's minimum-supported Node (the MCP server requires 18.2 for `closeAllConnections`). ([#161])

## [0.7.0] - 2026-07-09

### Added

- Rate-limited (`429`) and transient (`503`) responses are retried automatically: the CLI honors `Retry-After`, otherwise backs off exponentially with jitter, bounded by `QVERIS_MAX_RETRIES` (default 3; `0` disables). ([#144])
- `qveris doctor` / `qveris init` diagnostics: preflight checks (Node version, key, region, connectivity) with actionable hints and exact next commands. ([#131])
- Discover/inspect render `why_recommended`, standardized capability descriptors, `expected_cost`, and provider fields from the API. ([#102])

## [0.6.1] - 2026-07-06

### Fixed

- Accept object-shaped tool categories in discover/inspect results (legacy string tags still supported). ([#97])
- Hardened the MCP probe and call params/observability paths. ([#85])

## [0.6.0] - 2026-05-19

### Added

- `qveris init` — guided first-call wizard: auth → discover → inspect → call → usage/ledger reconciliation guidance. ([#32])
- `qveris mcp configure` / `qveris mcp validate` — generate and validate MCP client configs for Cursor, Claude Desktop, and others. ([#33])
- Generated OpenAPI contract types with drift CI, keeping the CLI aligned with the public API contract. ([#48])

### Fixed

- README examples aligned with actual CLI output. ([#35])

## [0.5.0] - 2026-05-06

### Added

- Billing transparency audit surfaces: `qveris usage` and `qveris ledger` with context-safe summaries. ([#18])
- Multi-region support (global/China) with key-prefix auto-detection and interactive region selection at login. ([#12], [#13])
- Canonical `discover` / `inspect` / `call` naming aligned across CLI and MCP. ([#14])

## [0.3.0] - 2026-04-08

### Added

- Gradient welcome/login banners. ([#10])

### Changed

- Batched ANSI spans in banner rendering; CLI install URL corrected across docs.

## [0.2.0] - 2026-04-04

### Added

- China region (`qveris.cn`) support. ([#9])

## [0.1.0] - 2026-04-04

### Added

- Initial release: `discover` / `inspect` / `call` from the terminal against the QVeris API.

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.8.1...HEAD
[0.8.1]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.8.0...cli-v0.8.1
[0.8.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.7.0...cli-v0.8.0
[0.7.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.6.1...cli-v0.7.0
[0.6.1]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.6.0...cli-v0.6.1
[0.6.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.5.0...cli-v0.6.0
[0.5.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.3.0...cli-v0.5.0
[0.3.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.2.0...cli-v0.3.0
[0.2.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/cli-v0.1.0...cli-v0.2.0
[0.1.0]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/cli-v0.1.0
[#221]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/221
[#226]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/226
[#204]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/204
[#161]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/161
[#144]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/144
[#131]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/131
[#102]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/102
[#97]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/97
[#85]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/85
[#48]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/48
[#35]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/35
[#33]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/33
[#32]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/32
[#18]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/18
[#14]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/14
[#13]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/13
[#12]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/12
[#10]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/10
[#9]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/9
