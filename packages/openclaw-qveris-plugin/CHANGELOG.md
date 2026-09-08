# Changelog

All notable changes to the OpenClaw QVeris plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are date-based (`YYYY.M.D`).

## [Unreleased]

## [2026.9.8] - 2026-09-08

### Added

- Added a manually dispatched ClawHub release workflow that builds an immutable tagged artifact and publishes it through Trusted Publishing with source provenance and Inspector reports. ([#352], [#354])

### Fixed

- Updated post-publish Registry verification to explicitly confirm the trusted package source required by current OpenClaw hosts. ([#351])
- Let ClawHub resolve the package owner from its trusted publisher binding instead of passing an unsupported owner override. ([#354])

## [2026.9.7] - 2026-09-07

### Added

- Added session-scoped, exact normalized-query Discover caching and TTL-bound successful-Capability memory with explicit refresh, clear, disable, provenance, and parameter-contract safeguards. ([#347])

### Changed

- Updated routing guidance to use QVeris when task fit or fallback needs warrant it, call directly from a sufficient Discover contract, and reserve Inspect for missing, stale, or comparative detail. ([#347])
- Upgraded the development and compatibility-test host to OpenClaw `2026.9.2`, migrated numeric tool parameter parsing and tool-context types to the current public plugin SDK surface, aligned the affected schemas with their positive-integer runtime contract, and updated packed and Registry release verification for the host's local-archive trust and capability-consent requirements. ([#348])
- The release workflow now waits for the exact public npm Registry artifact after publishing, verifies its version, downloaded integrity, source commit, runtime metadata, and concrete compiled tools, then installs it through the official OpenClaw plugin manager in isolated state before creating the GitHub Release. Publishing and verification run as separate jobs so a failed post-publish check can be retried without attempting to republish an immutable npm version. ([#283])

### Fixed

- Fresh Discover and Inspect responses now reconcile expired or proactively refreshed remembered routes without reusing stale intent, schema, or provenance; paid Call timeout and ambiguous transport outcomes remain explicitly non-replayable. ([#347])

## [2026.7.30] - 2026-07-30

### Fixed

- Declared all three runtime tools in `contracts.tools`, restoring tool registration on OpenClaw `>=2026.6.11`. The manifest now also declares explicit startup activation, API-key availability signals, and replay safety for read-only Discover/Inspect while keeping paid Call replay-unsafe. ([#272])
- Added source, compiled-factory, packed-package provenance, and minimum/extended/latest OpenClaw compatibility checks so public tool names, credential gating, and manifest/runtime registration cannot drift silently.

### Changed

- Aligned the full-toolkit development and CI Node.js pin with the `22.22.3` minimum required by the tested OpenClaw `2026.7.1-2` development dependency. The published plugin's existing runtime compatibility floor is unchanged.

## [2026.7.15] - 2026-07-15

### Changed

- Endpoint selection now uses `config.baseUrl`, then `QVERIS_BASE_URL`, then the built-in default. API keys and the deprecated `region` setting never reroute requests; unsafe endpoint overrides are rejected. ([#206])
- Raised the supported host to OpenClaw `>=2026.6.11` and Node.js `>=22.19.0`, matching the plugin API used by the current code. The full-toolkit development requirement is now Node.js `>=22.22.2`; plugin CI and builds use Node.js 22. ([#210])
- Pinned the tested OpenClaw host and plugin SDK metadata to `2026.6.11`, and aligned the peer, plugin API, and installer compatibility floors. ([#210])
- Upgraded the Vitest, coverage, Vite, and esbuild development toolchain to audited releases. Published runtime dependencies are unchanged. ([#211])

### Fixed

- Declared the public repository metadata required for npm to verify the package's signed provenance bundle.
- Builds now use the locked local `esbuild` dependency instead of downloading a build tool through `npx`; CI verifies the package can build in npm offline mode. ([#210])
- Corrected the local source installation path in the README. ([#210])
- The package is now installable and testable standalone: the `openclaw` dev dependency used the `workspace:*` protocol (a leftover from the OpenClaw monorepo) which made `npm install` fail; it now targets the published package. The three vitest suites (63 tests) and `tsc --noEmit` are wired into `npm test` / `npm run typecheck` and run in CI. ([#152])

### Added

- `why_recommended` and `expected_cost` from discover results are projected to the model, so capability selection can weigh relevance and cost. ([#104])

## [2026.6.4] - 2026-06-04

### Added

- First published build with compiled `dist/` output. ([#90])

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.9.8...HEAD
[2026.9.8]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.9.7...qveris-plugin-v2026.9.8
[2026.9.7]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.7.30...qveris-plugin-v2026.9.7
[2026.7.30]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.7.15...qveris-plugin-v2026.7.30
[2026.7.15]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.6.4...qveris-plugin-v2026.7.15
[2026.6.4]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/qveris-plugin-v2026.6.4
[#206]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/206
[#210]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/210
[#211]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/211
[#152]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/152
[#104]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/104
[#90]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/90
[#272]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/272
[#283]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/283
[#347]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/347
[#348]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/348
[#351]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/351
[#352]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/352
[#354]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/354
