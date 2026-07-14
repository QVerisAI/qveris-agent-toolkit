# Changelog

All notable changes to the OpenClaw QVeris plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are date-based (`YYYY.M.D`).

## [Unreleased]

### Changed

- Raised the supported host to OpenClaw `>=2026.6.11` and Node.js `>=22.19.0`, matching the plugin API used by the current code. The full-toolkit development requirement is now Node.js `>=22.22.2`; plugin CI and builds use Node.js 22. ([#210])
- Pinned the tested OpenClaw host and plugin SDK metadata to `2026.6.11`, and aligned the peer, plugin API, and installer compatibility floors. ([#210])

### Fixed

- Builds now use the locked local `esbuild` dependency instead of downloading a build tool through `npx`; CI verifies the package can build in npm offline mode. ([#210])
- Corrected the local source installation path in the README. ([#210])
- The package is now installable and testable standalone: the `openclaw` dev dependency used the `workspace:*` protocol (a leftover from the OpenClaw monorepo) which made `npm install` fail; it now targets the published package. The three vitest suites (63 tests) and `tsc --noEmit` are wired into `npm test` / `npm run typecheck` and run in CI. ([#152])

### Added

- `why_recommended` and `expected_cost` from discover results are projected to the model, so capability selection can weigh relevance and cost. ([#104])

## [2026.6.4] - 2026-06-04

### Added

- First published build with compiled `dist/` output. ([#90])

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.6.4...HEAD
[2026.6.4]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/qveris-plugin-v2026.6.4
[#210]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/210
[#152]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/152
[#104]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/104
[#90]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/90
