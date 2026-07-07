# QVeris Recipes

Recipes are copy-paste complete workflow templates for the QVeris Agent External Data & Tool Harness. Each recipe includes:

- `README.md` with CLI and Python SDK paths.
- `qveris.manifest.json` with permissions, compatibility, examples, and marketplace listing fields.

Validate all recipes:

```bash
node scripts/validate-ecosystem-manifests.mjs
```

## Included Recipes

| Recipe | Scenario | Primary integration |
|--------|----------|---------------------|
| [Finance research](finance-research/README.md) | Public company quote and market data research | CLI, Python SDK |
| [Risk and compliance](risk-compliance/README.md) | Sanctions, adverse media, and entity screening | CLI, Python SDK |
| [Crypto monitoring](crypto-monitoring/README.md) | Token price and market movement monitoring | CLI, Python SDK |
| [Data analysis](data-analysis/README.md) | Dataset enrichment with external data | CLI, Python SDK |
| [Developer automation](developer-automation/README.md) | Repository, issue, package, or API metadata lookup | CLI, Python SDK |
| [Explainable routing](explainable-routing/README.md) | Compare candidates on why_recommended, expected_cost, and quality, then explain the choice | CLI, Python SDK |
