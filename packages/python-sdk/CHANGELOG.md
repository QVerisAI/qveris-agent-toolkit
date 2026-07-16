# Changelog

All notable changes to the `qveris` Python SDK are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Native AutoGen, LlamaIndex, and Pydantic AI adapters, optional dependency extras, conformance tests, and runnable agent examples.
- Added an async `CredentialProvider` protocol and `ApiKeyCredentialProvider`. Existing `QverisConfig.api_key` behavior remains compatible, while applications can supply short-lived bearer credentials without changing endpoint selection. ([#226])

### Changed

- Expanded the Python SDK framework-integration guide with a support matrix, dependency boundaries, current agent APIs, lifecycle requirements, and all six supported adapters.
- Updated the LangChain/LangGraph example to use `langchain.agents.create_agent`, corrected CrewAI cleanup guidance, and quoted extras in shell install commands.

### Fixed

- Framework adapters now share canonical tool schemas and Pydantic-safe JSON serialization; LlamaIndex rejects its unsafe synchronous wrapper with async guidance instead of creating a fresh event loop around the persistent client.

## [0.3.2] - 2026-07-15

### Changed

- Releases now use PyPI Trusted Publishing with short-lived GitHub OIDC credentials and attestations for both wheel and source distributions. Package APIs and runtime behavior are unchanged. ([#222])

## [0.3.1] - 2026-07-14

### Fixed

- API endpoint overrides are normalized and validated as safe HTTP(S) URLs. Explicit `base_url` continues to override `QVERIS_BASE_URL`, and API keys never select the endpoint. ([#204])
- LangChain adapter: `search_id` is now optional in `qveris_call` and omitted from the request when absent — consistent with the OpenAI-Agents, CrewAI, and Vercel-AI adapters (the earlier consistency fix missed this adapter; caught by the new cross-adapter conformance suite). ([#157])

## [0.3.0] - 2026-07-09

### Added

- Framework adapters as optional extras: LangChain (`qveris[langchain]`), OpenAI Agents SDK (`qveris[openai-agents]`), and CrewAI (`qveris[crewai]`) — each exposes the discover/inspect/call workflow as native tools for that framework. ([#132], [#133], [#135])
- Per-session credit budget guard for the agent: `Agent(budget_credits=...)`. ([#130])
- Optional OpenTelemetry tracing (`qveris[otel]`): one span per discover/inspect/call with `qveris.*` attributes (tool_id, search_id, execution_id, elapsed_time_ms, credits); dependency-free no-op when opentelemetry is absent, and tracer faults never break a call. ([#141])
- Rate-limited (`429`) and transient (`503`) responses are retried automatically: honors `Retry-After` (measured against the response `Date` per RFC 9110), otherwise exponential backoff with jitter, bounded by `QverisConfig.max_retries` / `QVERIS_MAX_RETRIES` (default 3; `0` disables); `client.rate_limit_retries` surfaces backoff as pressure. ([#142])
- `ToolInfo` declares `capabilities`, `expected_cost`, `why_recommended`, and provider fields; explainable-routing example. ([#102], [#128])

### Fixed

- `QverisConfig(api_key=...)` explicit constructor values override environment variables again under pydantic 2.11+/2.12, without exposing the generic `API_KEY` / `BASE_URL` env names. ([#138])

### Removed

- `provider_logo_url` from type declarations (dropped from the public spec). ([#105])

## [0.2.1] - 2026-07-06

### Fixed

- Accept object-shaped tool categories in discover/inspect results (legacy string tags still supported); type widening recorded per review. ([#97])

## [0.2.0] - 2026-05-21

### Added

- First release of the typed client surface: `discover` / `inspect` / `call` / `usage` / `ledger` with pydantic v2 models for capabilities, billing, execution, and audit. ([#34])
- Generated OpenAPI contract models with drift CI. ([#48])
- `Agent` runtime: LLM tool loop over the QVeris workflow with streaming events.

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/python-sdk-v0.3.2...HEAD
[0.3.2]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/python-sdk-v0.3.1...python-sdk-v0.3.2
[0.3.1]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/python-sdk-v0.3.0...python-sdk-v0.3.1
[0.3.0]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/python-sdk-v0.2.1...python-sdk-v0.3.0
[0.2.1]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/python-sdk-v0.2.0...python-sdk-v0.2.1
[0.2.0]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/python-sdk-v0.2.0
[#222]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/222
[#204]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/204
[#226]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/226
[#157]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/157
[#142]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/142
[#141]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/141
[#138]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/138
[#135]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/135
[#133]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/133
[#132]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/132
[#130]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/130
[#128]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/128
[#105]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/105
[#102]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/102
[#97]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/97
[#48]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/48
[#34]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/34
