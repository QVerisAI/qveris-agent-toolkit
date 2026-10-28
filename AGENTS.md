# Working with QVeris

QVeris discovers professional data and tool capabilities. Discover returns tool candidates, not answers or provider data. Follow [Agent Guidelines](agent/GUIDELINES.md) for query construction, selection, parameters and recovery, and [Setup](agent/SETUP.md) for client installation.

## Access and cost

- Public read-only access must be chosen explicitly and permits Discover/Inspect only. It creates no account, trial credit or execution authority. Never silently discard invalid credentials to obtain public access.
- Use OAuth or an existing API key for authenticated operations. An agent trial is opt-in through `qveris auth trial`; preserve its secure credentials and recovery information. Never paste keys, claim proofs or tokens into prompts, URLs, source or logs.
- Start with Discover. Add Inspect only when the current contract is incomplete or must be refreshed, and Probe when current quote/preflight information is needed. Confirm inputs, permissions and cost before Call.
- A timeout does not prove a Call failed. Recover the original operation before resubmitting; retain execution and idempotency identifiers when available. Do not replay paid operations automatically.

## Contributing

Keep CLI, MCP and SDK behavior aligned with their owning package and published version. Use the package tests and documented release process in [RELEASING.md](RELEASING.md). Public docs use the active site's real API endpoint and must not expose internal deployment selectors. Preserve existing credentials and unrelated working-tree changes.
