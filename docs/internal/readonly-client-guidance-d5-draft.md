# D5 canonical client guidance preparation

Internal draft only; no new public client mode is documented as available. Baseline: `08baad550711c378cedc52a7729c2e0798d0fb90`. Website counterpart: `385d5855e01ba0f9bb820fabc9a393e048879abe`. This record does not publish packages or authorize merges.

## Canonical guide edit map

| Source family | Planned verified content | Publication dependency |
| --- | --- | --- |
| MCP, three doc sets | Keep Hosted OAuth default and valid-key fallback; describe actual explicit read-only entry as Discover/Inspect only; separate schema listing from successful invocation; use site-relative localized page links. | S6 frozen endpoint/catalog/errors plus W real installation configuration and support matrix. |
| Getting Started, three doc sets | Preserve accepted browser claim/history guidance; reconcile OAuth-first Discover-only first success into this canonical source before mirroring Website. Add a read-only choice only for a verified entry. | S5/S6 validated public contract; installed-client examples require actual supporting release. |
| CLI, three doc sets | Preserve valid-key precedence and OAuth login; add C4's actual explicit mode and 401/429 handling without automatic signup or credential downgrade. Public discovery state cannot authorize a later Call. | C4 implementation tests plus first actually published artifact; current 0.11.3 remains the recommendation. |
| JS/Python SDK guides, three doc sets | Document C4's actual explicit construction/API, operation restrictions, error types and identity upgrade. Keep current release markers and language-specific async examples aligned. | Published artifacts and C4 contract; current TS 0.9.0 / Python 0.8.0 remain the recommendation. |
| Package READMEs/generated SDK references | Coordinate necessary patches through coordinator; C owns client requirements, S owns backend schema export. | Do not edit or regenerate those paths concurrently. |

## Contract-dependent prose skeleton

Explicit public read-only access will be described only after its real entry and supporting client versions are accepted. Its scope is public Discover/Inspect. It must not issue an identity, grant credits, execute a provider operation or authorize Call. An invalid supplied credential remains an authentication failure. OAuth remains the default authenticated path.

For 429, follow the actual server retry guidance and bounded read retry policy; do not promise that login bypasses limits. For 401, authenticate/reconnect deliberately without blindly replaying paid work. A public result/context can preserve a selection hint but never execution authority; obtain the required current authenticated contract and quote after upgrade. The exact transition and field names must come from S/C validation.

No future flag, constructor, endpoint, tool alias, header or numerical rate limit is guessed in this draft. Current CLI 0.11.3, MCP 0.15.0, TS SDK 0.9.0 and Python SDK 0.8.0 were independently checked against official registries and immutable artifacts. A main-branch source merge without publication does not update those artifacts.

## Source reconciliation boundary

Website's source-aware check against this baseline reports 19 substantive Toolkit-owned differences. All 11 Website-owned mirrors match. CLI/MCP/Getting Started differences include accepted Website onboarding and link-policy improvements; SDK differences include tested-release markers and newer canonical generated APIs. Preserve the accepted semantics at source and carry only reviewed hunks to Website. No bulk import, release-marker removal, dependency change or generated-reference refresh is part of preparation.

The detailed per-path inventory, artifact hashes, client/error matrix and machine-entry gaps are in Website `docs/internal/access-readonly-d5-audit-2026-10-27.md`. This canonical draft stays separate from public guidance until producer contracts and actual publication identities arrive.

## S5 REST coordination update

The producer froze existing POST `/search` and `/tools/by-ids` with explicit `X-Qveris-Access-Mode: public-readonly`, restricted public DTO and no credentials/cookies. The Website REST/auth/LLM draft is being prepared from that contract. This does not define a CLI flag, SDK factory or Hosted MCP path. C4 must reject conflicts with configured credentials instead of silently omitting them. Authentication upgrade can refresh Inspect and necessary quote for the selected tool; no extra Discover is mandatory solely for upgrading. Keep public context out of execution authority. Wait for actual published C4 identities before changing current client install examples.

## Canonical draft now includes frozen REST and S6 target

Added only targeted hunks to the three Getting Started sources and three MCP guide sources. The matching hunks are copied to Website; full-file parity is not claimed. S6 targets a separate `/mcp/readonly` stateless POST endpoint on the current Hosted MCP origin, only canonical Discover/Inspect, with credential/session conflict rejection. Default OAuth remains unchanged. No CLI/SDK mode is advertised at current package versions. Producer transport tests and W per-client installation acceptance remain pending, so this PR remains draft.

## Current client baseline and source reconciliation preparation

The independent documentation branch now includes accepted Toolkit main `449a3957cb55b1ec2a9dba7dcaeda79e2e3b6872` (CLI #463 and SDK #464). Those are source deliveries, not publication. Current public installation examples still use CLI 0.11.3, MCP 0.15.0, TypeScript SDK 0.9.0 and Python SDK 0.8.0; no unpublished client syntax or release binding is added.

Targeted canonical edits restore the accepted OAuth/Discover-only CLI quickstarts, put the released one-Discover SDK examples before optional paid/model-driven examples, and keep the optional advanced validation flows intact. Model-provider credentials are scoped to the optional model-driven example. Default Hosted MCP setup uses URL-only OAuth configuration; key/stdio fallbacks remain separate. A small cross-client/error/upgrade matrix distinguishes real public REST/Hosted access from current published local clients, including omission of public search_id on authenticated Inspect. Only the selected CLI/MCP/Getting Started families are reconciled; generated SDK references and unrelated drift are not imported or rewritten.

S6 actual source `ad4d547676b05e692dd01644f2c3d0556f25d76a` supports the supplied endpoint and standard protocol progress metadata, with 156 service tests and real frozen-S5/SDK fixture acceptance; current source delivery is not availability. Origin-bearing public clients must be explicitly allowed; empty lists allow native clients without Origin. The producer's newer schema fix remains owned by S5 and its final acceptance, not relabeled from the frozen archive.

This remains a draft until S6 is accepted and merged. Website D5 branch is deliberately unchanged while W6 integration is pending; matching source hunks will be carried after W6 merges and one final Website synchronization. No target branch or shared plan is advanced by this preparation.
