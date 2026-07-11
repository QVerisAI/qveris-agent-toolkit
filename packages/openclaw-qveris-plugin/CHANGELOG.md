# Changelog

All notable changes to the OpenClaw QVeris plugin are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions are date-based (`YYYY.M.D`).

## [Unreleased]

### Changed

- Declared `engines.node` `>=18.2.0`, aligning with the rest of the toolkit. ([#161])

### Fixed

- The package is now installable and testable standalone: the `openclaw` dev dependency used the `workspace:*` protocol (a leftover from the OpenClaw monorepo) which made `npm install` fail; it now targets the published package. The three vitest suites (63 tests) and `tsc --noEmit` are wired into `npm test` / `npm run typecheck` and run in CI. ([#152])

### Added

- `why_recommended` and `expected_cost` from discover results are projected to the model, so capability selection can weigh relevance and cost. ([#104])

## [2026.6.4] - 2026-06-04

### Added

- First published build with compiled `dist/` output. ([#90])

[Unreleased]: https://github.com/QVerisAI/qveris-agent-toolkit/compare/qveris-plugin-v2026.6.4...HEAD
[2026.6.4]: https://github.com/QVerisAI/qveris-agent-toolkit/releases/tag/qveris-plugin-v2026.6.4
[#161]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/161
[#152]: https://github.com/QVerisAI/qveris-agent-toolkit/issues/152
[#104]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/104
[#90]: https://github.com/QVerisAI/qveris-agent-toolkit/pull/90
