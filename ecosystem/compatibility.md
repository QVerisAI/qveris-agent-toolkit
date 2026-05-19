# Ecosystem Compatibility Matrix

The ecosystem manifest is designed to keep recipes, skills, plugins, and marketplace listings aligned across QVeris integration surfaces.

| Surface | Minimum version | Used for |
|---------|-----------------|----------|
| Manifest schema | `2026-05-13` | Shared metadata, permissions, docs, examples, and marketplace listing fields |
| QVeris CLI | `>=0.6.0` | `discover`, `inspect`, `call`, `usage`, `ledger`, and `init` recipe commands |
| QVeris MCP server | `>=0.7.0` | Canonical MCP tools plus usage and credits ledger audit tools |
| QVeris Python SDK | `>=0.2.0` | Typed `QverisClient`, `Agent`, and audit methods |
| QVeris agent skill | `>=0.1.0` | Agent-facing discover, inspect, call, and audit workflow guidance |

## Compatibility Policy

- Recipe manifests should declare every surface they depend on.
- Existing recipe IDs remain stable across recipe version updates.
- Deprecated tool aliases must not be used in new manifests or examples.
- New required manifest fields require a new `schema_version`.
- Additive marketplace fields may be introduced without invalidating the `2026-05-13` schema only when the validator treats them as optional.
