# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

- Preferred: use GitHub's private vulnerability reporting — [Security → Report a vulnerability](https://github.com/QVerisAI/qveris-agent-toolkit/security/advisories/new).
- Alternatively, email **contact@qveris.ai** with the details.

We aim to acknowledge reports within 3 business days. Please include reproduction steps, the affected package/version, and impact assessment if you have one.

## Scope

This repository covers the QVeris client toolkit: `@qverisai/cli`, `@qverisai/mcp`, `@qverisai/sdk`, the `qveris` Python SDK, and the OpenClaw plugin. Vulnerabilities in the QVeris platform/API itself can be reported through the same channels.

## Supported versions

Only the latest released version of each package receives security fixes.

## Handling of credentials

- API keys are only ever sent as `Authorization: Bearer` headers to the configured QVeris endpoint; debug output redacts them.
- The MCP server's remote (HTTP) mode refuses to bind non-loopback interfaces without inbound auth (fail-closed); see `packages/mcp/README.md`.
