# Benchmark catalog and artifact publication policy

The public repository documents what QVeris can do without publishing account,
connection, execution, or bulk catalog-operational data.

## Visibility classes

- `public`: approved provider/tool metadata may be searched and referenced in
  public documentation and benchmark examples.
- `unlisted`: metadata is available only through an explicit link, invitation,
  or allowlist and must not appear in public search or benchmark artifacts.
- `private`: metadata is visible only to its tenant or owner.
- `quarantined` / `deprecated`: metadata is excluded from public recommendation
  and new benchmark baselines.

Until the production discovery contract exposes an explicit visibility field,
catalog entries default to private for bulk artifact publication.

## Public metadata

For an explicitly approved public tool, public surfaces may include its stable
tool ID, provider name, capability description, categories, version, input and
output schema, authentication type, required scopes, documentation, deprecation
status, and safe examples.

Public reliability data must use minimum sample thresholds and rounded bands.
Exact ranking features, weights, call counts, provider costs, tenant eligibility,
and account-specific availability remain internal.

## Never public

Public artifacts must not contain API keys, OAuth tokens, connection/account
identifiers, `search_id`, `execution_id`, credit balances, raw provider errors,
raw tool results, private prompts, tenant-private tools, or the unfiltered
ordered discovery catalog.

The publication command enforces `publication-policy.json`. It replaces the
ordered discovery list with its count and SHA-256 digest and preserves grounded
selection as an attestation. An approved selected tool keeps its ID; an
unapproved selected tool is represented only by a SHA-256 digest, so a benchmark
run cannot silently expand the public catalog.

Provider authorization and namespace ownership must be confirmed before adding a
tool ID to the public allowlist. Removing an approval requires regenerating all
affected public artifacts.
