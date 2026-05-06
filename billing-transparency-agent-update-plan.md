# QVerisAI Billing Transparency Agent Surface Update Plan

> Date: 2026-05-04
>
> Scope: Update the Agent-facing surfaces in this repository so CLI, MCP, REST docs, and skills expose QVeris billing transparency and usage audit capabilities clearly, without flooding Agent context windows with raw history rows.

## 1. Background

The QVeris core and website service layer now expose billing transparency primitives:

- Rule-level billing metadata: `billing_rule`, `tool_metering_spec`
- Per-call pre-settlement billing: compact `billing`, `pre_settlement_bill`
- Final settlement and ledger metadata: `settlement_result`, `credits_ledger`
- Request-level usage audit: `usage/history/v2`, `charge_outcome`, `execution_outcome`

QVerisAI currently exposes QVeris mainly through:

- CLI under `packages/cli`
- MCP server under `packages/mcp`
- Agent guidelines under `agent`
- Skills under `skills`
- User and integration docs under `docs`

The current Agent-facing contract still relies too heavily on legacy fields such as `cost`, `credits_used`, and broad "1-100 credits" wording. The update must expose the newer billing and audit model while keeping Agent usage simple.

## 2. Goals

1. Make Agents understand three separate concepts:
   - Billing rule: how a capability is priced.
   - Pre-settlement bill: what this call theoretically costs.
   - Settlement / ledger: what was actually deducted or granted.
2. Let Agents answer common user questions:
   - Did this failed call charge credits?
   - Which call caused this deduction?
   - What were the largest charges in a time range?
   - How did my credits balance change?
3. Prevent large usage or ledger datasets from being dumped directly into Agent context.
4. Keep CLI and MCP choices minimal and obvious.
5. Preserve raw JSON access for scripts without making raw full history the default.

## 3. Non-Goals

- Do not add many specialized MCP tools for every audit subcase.
- Do not expose backfill, readiness, reconciliation, admin, or export endpoints as Agent tools.
- Do not default to full row dumps from usage history or ledger endpoints.
- Do not remove legacy `cost` or `credits_used` compatibility in this release.
- Do not make Agents reason about internal settlement implementation details unless the user asks for audit detail.

## 4. Service-Side Dependencies

The service team is expected to update the following website endpoints:

- `GET /api/v1/auth/usage/history/v2`
- `GET /api/v1/auth/credits/ledger`

Required service behavior:

1. Both endpoints support `Authorization: Bearer <API_KEY>` in addition to the existing dashboard token flow.
2. API Key auth works for global and China keys:
   - `sk-*`
   - `sk-cn-*`
3. The endpoints support context-safe querying:
   - Time range: `start_date`, `end_date`
   - Pagination: `page`, `page_size`
   - Amount filters: `min_credits`, `max_credits`
   - Usage filters: `execution_id`, `search_id`, `charge_outcome`, `event_type`, `kind`, `success`
   - Ledger filters: `entry_type`, `direction`
4. The service supports summary aggregation for Agent-facing clients:
   - `summary=true`
   - `bucket=hour|day|week`
   - `limit` capped to high-signal samples
5. CLI and MCP should prefer service-side summary responses and retain safe client-side aggregation as a compatibility fallback.

## 5. Agent-Facing Design Principles

### 5.1 Minimal Tools

Only add two new high-level Agent tools:

- `usage_history`
- `credits_ledger`

Do not add separate MCP tools for detail, export, readiness, reconciliation, or admin views.

### 5.2 Context Protection

Default behavior must return summary, not raw rows.

Default guardrails:

- Default mode: `summary`
- Default time window: last 24 hours when no range is provided
- Default bucket:
  - hour for windows up to 48 hours
  - day for windows up to 60 days
  - week for longer windows
- Default detail limit: 10 rows
- Hard detail limit: 50 rows
- Full exports are written to local files and only metadata is returned to the Agent.

### 5.3 Output Modes

Both `usage_history` and `credits_ledger` use the same mode concept.

#### `summary`

Returns aggregated information for fast Agent reasoning.

Usage summary includes:

- Total events
- Succeeded count
- Failed count
- Count by `charge_outcome`
- Total requested credits
- Total actual credits
- Top charges, capped at 10
- Bucketed totals by hour, day, or week

Ledger summary includes:

- Total entries
- Total consumed credits
- Total granted credits
- Net credits change
- Count and amount by `entry_type`
- Top debits, capped at 10
- Bucketed net changes by hour, day, or week

#### `search`

Returns bounded row-level records for precise investigation.

Examples:

- Find usage by `execution_id`
- Find usage by `search_id`
- Find failed calls that were charged
- Find charges greater than 50 credits
- Find charges between 30 and 100 credits
- Find ledger entries for a specific time window

Search output must be capped:

- Default `limit`: 10
- Maximum `limit`: 50

#### `export_file`

Writes raw records to a local file and returns metadata only.

Expected output:

- `file_path`
- `record_count`
- `start_date`
- `end_date`
- `filters`
- `format`
- A short note that the Agent should read/process the file in chunks

Recommended file paths:

- `.qveris/exports/usage_history_<timestamp>.jsonl`
- `.qveris/exports/credits_ledger_<timestamp>.jsonl`

## 6. CLI Plan

### 6.1 Existing Commands

Update existing CLI behavior without changing the command names.

#### `qveris discover`

Current behavior shows `stats.cost` as a primary cost field.

New behavior:

- Prefer `billing_rule` when present.
- Show a concise billing rule label.
- Keep `stats.cost` only as fallback.
- Preserve raw JSON output exactly.

#### `qveris inspect`

New behavior:

- Show structured billing rule detail:
  - metering mode
  - billing unit
  - unit price
  - minimum charge
  - pricing dimensions
  - billing description
- Avoid presenting `cost` as final charge.

#### `qveris call`

New behavior:

- Show call status and execution ID.
- Show compact billing summary when present:
  - `billing.summary`
  - `list_amount_credits`
  - charge lines
- Label it as pre-settlement billing.
- Tell users to use `qveris usage --execution-id <id>` for final charge status when helpful.

#### `qveris credits`

Current behavior checks balance through a `/search` call.

New behavior:

- Use `GET /api/v1/auth/credits`.
- Show total balance and bucket balances:
  - `daily_free`
  - `invite_reward`
  - `welcome_bonus`
  - `purchased`

### 6.2 New Command: `qveris usage`

Purpose: answer "what happened during recent calls, and were they charged?"

Suggested syntax:

```bash
qveris usage
qveris usage --mode summary --bucket hour
qveris usage --mode search --execution-id <execution_id>
qveris usage --mode search --charge-outcome failed_charged_review
qveris usage --mode search --min-credits 30 --max-credits 100
qveris usage --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

Supported flags:

- `--mode summary|search|export-file`
- `--start-date YYYY-MM-DD`
- `--end-date YYYY-MM-DD`
- `--bucket hour|day|week`
- `--execution-id <id>`
- `--search-id <id>`
- `--event-type <type>`
- `--kind <kind>`
- `--success true|false`
- `--charge-outcome charged|included|failed_not_charged|failed_charged_review`
- `--min-credits <number>`
- `--max-credits <number>`
- `--limit <number>`
- `--json`

Formatted summary output should include:

- Time range
- Bucket size
- Total events
- Success and failure counts
- Charge outcome counts
- Requested credits total
- Actual credits total
- Top charges

Formatted search output should include only high-signal fields:

- `created_at`
- `event_type`
- `success`
- `charge_outcome`
- `tool_id` / `model` / `query`
- `execution_id`
- `search_id`
- `billing_summary`
- `requested_amount_credits`
- `actual_amount_credits`
- `credits_ledger_entry_id`
- `error_message`

### 6.3 New Command: `qveris ledger`

Purpose: answer "why did my credit balance change?"

Suggested syntax:

```bash
qveris ledger
qveris ledger --mode summary --bucket day
qveris ledger --mode search --min-credits 50 --direction consume
qveris ledger --mode search --entry-type consume_tool_execute
qveris ledger --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

Supported flags:

- `--mode summary|search|export-file`
- `--start-date YYYY-MM-DD`
- `--end-date YYYY-MM-DD`
- `--bucket hour|day|week`
- `--entry-type <type>`
- `--direction consume|grant|any`
- `--min-credits <number>`
- `--max-credits <number>`
- `--limit <number>`
- `--json`

Formatted summary output should include:

- Time range
- Bucket size
- Entry count
- Total consumed credits
- Total granted credits
- Net change
- Amount by entry type
- Top debit entries

Formatted search output should include:

- `created_at`
- `entry_type`
- `amount_credits`
- `source_ref_type`
- `source_ref_id`
- `description`
- `pre_settlement_bill.summary`
- `settlement_result.settled_amount_credits`
- `settlement_result.bucket_deductions`

### 6.4 CLI Implementation Files

Expected files to update or add:

- `packages/cli/src/client/api.mjs`
- `packages/cli/src/main.mjs`
- `packages/cli/src/commands/credits.mjs`
- `packages/cli/src/commands/usage.mjs`
- `packages/cli/src/commands/ledger.mjs`
- `packages/cli/src/output/formatter.mjs`
- `packages/cli/src/output/billing.mjs`
- `packages/cli/src/output/audit.mjs`
- `packages/cli/src/utils/date-range.mjs`
- `packages/cli/src/utils/amount-filter.mjs`

## 7. MCP Plan

### 7.1 Existing MCP Tools

Keep:

- `discover`
- `inspect`
- `call`

Deprecated aliases remain:

- `search_tools`
- `get_tools_by_ids`
- `execute_tool`

Update tool descriptions:

- `discover` and `inspect` may return `billing_rule`.
- `call` may return compact `billing`.
- Final charge status should be checked with `usage_history` or `credits_ledger`.

### 7.2 New MCP Tool: `usage_history`

Purpose: context-safe usage audit query.

Input schema:

- `mode`: `summary | search | export_file`, default `summary`
- `start_date`: optional `YYYY-MM-DD`
- `end_date`: optional `YYYY-MM-DD`
- `bucket`: `hour | day | week`, optional
- `execution_id`: optional
- `search_id`: optional
- `event_type`: optional
- `kind`: optional
- `success`: optional boolean
- `charge_outcome`: optional enum
- `min_credits`: optional number
- `max_credits`: optional number
- `limit`: optional number, default 10, maximum 50

Default response:

- Summary object, not raw rows.
- Include `sample_records` only when useful and capped.

### 7.3 New MCP Tool: `credits_ledger`

Purpose: context-safe final credit ledger query.

Input schema:

- `mode`: `summary | search | export_file`, default `summary`
- `start_date`: optional `YYYY-MM-DD`
- `end_date`: optional `YYYY-MM-DD`
- `bucket`: `hour | day | week`, optional
- `entry_type`: optional
- `direction`: `consume | grant | any`, default `any`
- `min_credits`: optional number
- `max_credits`: optional number
- `limit`: optional number, default 10, maximum 50

Default response:

- Summary object, not raw rows.
- Include top debit records only when useful and capped.

### 7.4 MCP Implementation Files

Expected files to update or add:

- `packages/mcp/src/types.ts`
- `packages/mcp/src/api/client.ts`
- `packages/mcp/src/index.ts`
- `packages/mcp/src/tools/usage-history.ts`
- `packages/mcp/src/tools/credits-ledger.ts`
- `packages/mcp/src/tools/audit-utils.ts`
- `packages/mcp/src/tools/usage-history.test.ts`
- `packages/mcp/src/tools/credits-ledger.test.ts`

## 8. Shared Data Shaping Rules

### 8.1 Amount Filtering

Usage amount filter:

- Prefer `actual_amount_credits`
- Fall back to `settled_amount_credits`
- Fall back to `requested_amount_credits`

Ledger amount filter:

- Use absolute value of `amount_credits`
- `direction=consume` means negative ledger amounts
- `direction=grant` means positive ledger amounts

### 8.2 Bucket Aggregation

Bucket key rules:

- `hour`: UTC hour, ISO string like `2026-05-04T10:00:00Z`
- `day`: UTC date like `2026-05-04`
- `week`: ISO week label like `2026-W19`

### 8.3 Output Limits

Hard limits:

- Formatted rows: max 50
- Default formatted rows: 10
- MCP text payload should remain compact.
- If result would exceed the limit, return:
  - `truncated: true`
  - `shown_records`
  - `matched_records`
  - suggestion to use `export_file`

### 8.4 Export Files

Export mode writes JSONL, not a huge JSON array.

Each record is one line. This lets Agents process data with streaming tools, `rg`, `jq`, or scripts without loading the full file into context.

Export metadata example:

```json
{
  "mode": "export_file",
  "file_path": ".qveris/exports/usage_history_20260504T102030Z.jsonl",
  "format": "jsonl",
  "record_count": 1240,
  "start_date": "2026-05-01",
  "end_date": "2026-05-04",
  "filters": {
    "min_credits": 30
  }
}
```

## 9. Documentation Plan

### 9.1 Agent Docs

Update:

- `agent/GUIDELINES.md`
- `agent/SETUP.md`
- `agent/llms.txt`
- `agent/llms-full.txt`

Key changes:

- Replace simple "1-100 credits" wording with structured billing language.
- Add "Billing rule vs pre-settlement bill vs final ledger" explanation.
- Add "How to check whether a failed call was charged".
- Add context-safe guidance:
  - Use summaries first.
  - Use precise filters second.
  - Use export files for large analysis.

### 9.2 CLI Docs

Update:

- `packages/cli/README.md`
- `docs/en-US/cli.md`
- `docs/zh-CN/cli.md`

Add:

- `qveris usage`
- `qveris ledger`
- Summary/search/export-file examples
- Warning that raw full history should not be printed into Agent context

### 9.3 MCP Docs

Update:

- `packages/mcp/README.md`
- `docs/en-US/mcp-server.md`
- `docs/zh-CN/mcp-server.md`

Add:

- `usage_history`
- `credits_ledger`
- Minimal examples for:
  - recent usage summary
  - failed charged review
  - charges greater than 50 credits
  - ledger summary

### 9.4 REST API Docs

Update:

- `docs/en-US/rest-api.md`
- `docs/zh-CN/rest-api.md`
- `docs/cn/zh-CN/rest-api.md`

Add:

- API Key auth support for usage and ledger endpoints
- Query filters
- Summary/search/export-file behavior as implemented in CLI/MCP
- Field reference for billing transparency fields

### 9.5 Skills

Update:

- `skills/qveris/SKILL.md`
- `skills/openclaw/qveris-official/SKILL.md`
- `skills/openclaw/qveris-official/README.md`
- `skills/openclaw/qveris-official/scripts/qveris_client.mjs`
- `skills/openclaw/qveris-official/scripts/qveris_tool.mjs`

Key changes:

- Add billing audit self-check.
- Add usage and ledger commands only if needed.
- Ensure OpenClaw helper does not print full history by default.
- Add region-aware base URL selection for `sk-cn-*`.

## 10. Execution Plan

### Phase 1: Contract and Helpers

Deliverables:

- Shared billing and audit type definitions.
- Formatter helpers for billing rule, compact billing, usage rows, and ledger rows.
- Date range and amount filter helpers.

Validation:

- Unit tests for billing summary extraction.
- Unit tests for amount filtering.
- Unit tests for aggregation bucket selection.

### Phase 2: CLI Implementation

Deliverables:

- Update `discover`, `inspect`, `call`, and `credits`.
- Add `usage`.
- Add `ledger`.
- Add export-file behavior.

Validation:

- Mocked API tests for each command.
- Manual smoke tests with `--json`.
- Ensure default output is bounded.

### Phase 3: MCP Implementation

Deliverables:

- Update type definitions.
- Add `usage_history` tool.
- Add `credits_ledger` tool.
- Add context-safe summary/search/export-file logic.

Validation:

- `npm run typecheck` in `packages/mcp`.
- `npm test` in `packages/mcp`.
- Verify MCP tool list stays small and clear.

### Phase 4: Skills and Agent Guidance

Deliverables:

- Update agent guidelines.
- Update skill instructions.
- Update OpenClaw helper script.

Validation:

- Search all docs for stale "cost only" wording.
- Confirm examples use summary/search/export-file patterns.

### Phase 5: Public Docs

Deliverables:

- Update CLI docs.
- Update MCP docs.
- Update REST docs.
- Update root README and Chinese README if pricing/audit wording is stale.

Validation:

- Link check by inspection.
- Stale wording search:
  - `1-100 credits`
  - `cost`
  - `credits_used`
  - `expected_cost`

### Phase 6: Release Prep

Deliverables:

- Version bumps:
  - `@qverisai/cli`: minor version
  - `@qverisai/mcp`: minor version
- Release notes summarizing:
  - API Key authenticated usage and ledger queries
  - Context-safe summaries
  - Precise amount/time filters
  - Local JSONL exports

Validation:

- `git diff --check`
- CLI smoke tests
- MCP typecheck and tests

## 11. Acceptance Criteria

### Agent UX

- An Agent can answer "was this failed call charged?" using `usage_history` without dumping all history.
- An Agent can answer "why did my balance change?" using `credits_ledger` without dumping all ledger rows.
- An Agent can find high-cost records with `min_credits` / `max_credits`.
- An Agent can inspect a precise time range.
- Full-history analysis writes to a local JSONL file and returns metadata only.

### Safety

- Default output never emits more than 10 detail records.
- Explicit search never emits more than 50 detail records.
- MCP default mode is `summary`.
- CLI default mode is `summary`.
- Raw full exports are never printed to stdout by default.

### Compatibility

- Existing CLI commands continue to work.
- Existing MCP tools continue to work.
- Deprecated MCP aliases continue to work.
- Legacy fields remain available in JSON output.

### Billing Correctness

- `billing_rule` is presented as pricing rule metadata.
- Compact `billing` is presented as pre-settlement billing.
- `usage_history.charge_outcome` is used for charge outcome.
- `credits_ledger` is used for final credit balance movement.

## 12. Risk Register

| Risk | Impact | Mitigation |
|------|--------|------------|
| Service summary response is unavailable in an older deployment | CLI/MCP may need to page records | Prefer `summary=true`; retain client-side aggregation fallback with page and row hard limits |
| Agents confuse pre-settlement with final charge | Wrong billing explanation | Label output clearly and point to `usage_history` / `credits_ledger` |
| History query returns too many rows | Context bloat | Default summary, hard row caps, export-file mode |
| API Key auth differs from JWT behavior | Agent audit calls fail | Add explicit auth tests and clear error messages |
| Old docs mention `cost` as final charge | Misleading Agent behavior | Search and update stale docs |

## 13. Open Questions

1. Should `min_credits` / `max_credits` filter by requested amount, actual settled amount, or both? Recommended:
   - usage: actual amount first, requested amount fallback
   - ledger: absolute `amount_credits`
2. Should export files default to JSONL only, or support CSV as an optional flag later? Recommended: JSONL first.
3. Should exported files include full request payloads? Recommended: no by default; include only safe audit fields unless a future explicit flag is added.

## 14. Execution Update: 2026-05-04

Implemented in this repository:

- CLI:
  - Added API helpers for `/auth/credits`, `/auth/usage/history/v2`, and `/auth/credits/ledger`.
  - Added `qveris usage` and `qveris ledger`.
  - Default mode is context-safe summary.
  - Summary mode requests service-side `summary=true` when available and falls back to bounded client-side aggregation.
  - `--mode search` returns capped rows with precise filters.
  - `--mode export-file` writes raw matching rows to `.qveris/exports/*.jsonl` and prints only metadata.
  - Discover/inspect/call formatting now prefers `billing_rule` and compact pre-settlement `billing`; legacy `cost` remains fallback only.

- MCP:
  - Added `usage_history` and `credits_ledger` tools.
  - Added shared aggregation/filter/export helpers.
  - Summary mode requests service-side `summary=true` when available and falls back to bounded client-side aggregation.
  - Added typed API methods and response models for audit and ledger endpoints.
  - Added unit tests for summary/search behavior and API client query construction.

- Agent docs and skills:
  - Updated root README files, Agent guidelines, llms context files, setup docs, CLI docs, MCP docs, REST API docs, and QVeris skills.
  - Replaced broad final-charge wording with three-layer billing guidance:
    - `billing_rule`: rule-level pricing metadata.
    - `billing` / `pre_settlement_bill`: pre-settlement call estimate.
    - `usage_history` / `credits_ledger`: final charge outcome and balance movement.

- Release prep:
  - Bumped `@qverisai/cli` from `0.4.0` to `0.5.0`.
  - Bumped `@qverisai/mcp` from `0.5.0` to `0.6.0`.
  - Added release-note highlights for context-safe audit summaries, precise filters, and local JSONL exports.

Verification completed:

- `node --check` for changed CLI modules and OpenClaw helper scripts.
- CLI smoke checks: `qveris --version` and `qveris --help --no-color`.
- `npm run typecheck` in `packages/mcp`.
- `npm test` in `packages/mcp`: 6 test files, 56 tests passed.
- `git diff --check`.

Remaining service dependency:

- API Key authentication and query/filter behavior must be verified against the deployed service for:
  - `GET /api/v1/auth/usage/history/v2`
  - `GET /api/v1/auth/credits/ledger`
