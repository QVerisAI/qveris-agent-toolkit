# QVeris Ecosystem Manifests

QVeris ecosystem entries use a versioned manifest to describe recipes, skills, plugins, and marketplace-ready listings with the same metadata surface.

The current schema is [`manifest.schema.json`](manifest.schema.json), version `2026-05-13`.

## What The Manifest Covers

- Identity: stable `id`, `kind`, `name`, `version`, and lifecycle `status`.
- Marketplace listing fields: `listing_slug`, `headline`, `audience`, `use_cases`, `integration_methods`, and `primary_cta`.
- Permissions: QVeris capability scopes, network hosts, local files, and secrets.
- Compatibility: minimum CLI, MCP, Python SDK, skill, or plugin versions.
- Docs and examples: required local README plus runnable or copy-paste complete commands.

## Validation

Run the validator from the repository root:

```bash
node scripts/validate-ecosystem-manifests.mjs
```

Validate a specific manifest or directory:

```bash
node scripts/validate-ecosystem-manifests.mjs recipes/finance-research/qveris.manifest.json
node scripts/validate-ecosystem-manifests.mjs recipes
```

CI runs the same validator on recipe, schema, and validator changes. A manifest fails validation when required metadata is missing, permission declarations are incomplete, examples point at missing docs, or marketplace listing fields are absent.

Run validator regression tests:

```bash
node scripts/test-ecosystem-validator.mjs
```

## Manifest Templates

- [`templates/skill-manifest.template.json`](templates/skill-manifest.template.json)
- [`templates/plugin-manifest.template.json`](templates/plugin-manifest.template.json)

Use these as starting points, then replace every placeholder before committing a real `qveris.manifest.json`.

## Related Docs

- [Contribution guide](CONTRIBUTING.md)
- [Compatibility matrix](compatibility.md)
- [Recipes](../recipes/README.md)
