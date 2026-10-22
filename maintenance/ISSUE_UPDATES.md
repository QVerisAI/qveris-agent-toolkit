# Applied issue audit — 2026-10-21

This replaces the unposted 2026-10-03 draft. The issue bodies and dispositions below have now been applied. Source evidence was checked against toolkit main `d060e00` and the deployed public OpenAPI `2026-10-15.1`. Implementation, published artifacts, historical directory acceptance and fresh live-service acceptance remain separate claims.

## Completed cleanup

- [#200](https://github.com/QVerisAI/qveris-agent-toolkit/issues/200): closed as not planned because remaining tracking was consolidated into #228. API Key, Device Flow and Delegation client implementation is shipped; this closure does not assert live Delegation acceptance.
- [#65](https://github.com/QVerisAI/qveris-agent-toolkit/issues/65): archived as not planned. Its remaining speculative fields are absent from the public contract; closing does not claim they were implemented.

## Active work, in priority order

### #228 — Registered-client live Delegation acceptance

[Issue](https://github.com/QVerisAI/qveris-agent-toolkit/issues/228) now tracks only real-service acceptance. #294 delivered the providers and #416 hardened bounded cache/expiry/clear concurrency; JS 0.9.0 and Python 0.8.0 include those improvements.

The remaining gate is a registered confidential test client and authorized test context, then success, actual narrowing enforcement, expiry, wrong audience and revoke/introspection. Synthetic fixtures do not establish Resource Server enforcement. Credentials must remain in secure storage; an API key cannot substitute for a confidential client. No new live exchange or paid execution was performed in this audit. The issue is labeled blocked for missing test-client context, not an unpublished protocol.

### #368 — Finish directory acceptance and refresh notes

[Issue](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368) now records seven historically accepted targets: Gemini Gallery, Glama, Remote Awesome MCP, Smithery, mcpservers.org, Awesome AI Plugins and TensorBlock.

Remaining: Cursor Marketplace acceptance/clean install; local Awesome MCP [#14435](https://github.com/punkpeye/awesome-mcp-servers/pull/14435), still open on 2026-10-21; and mcp.so ingestion/install evidence. The final automatic-versus-manual refresh notes are also required. Upstream remote MCP #184, AI Plugins #266 and TensorBlock #2276 remain merged. Smithery's public listing is visible; other historical runtime acceptance is explicitly not revalidated. Do not treat search-engine absence as proof that a directory entry does not exist.

### #293 — Future Capability contracts only

[Issue](https://github.com/QVerisAI/qveris-agent-toolkit/issues/293) now separates shipped typed Detail/Query from future Resolve/selection/freshness and Query recovery prerequisites. It remains blocked and is lowered from P1 to P2 until those contracts are published. #416/#418 implemented and prepared the available endpoints and single-submit behavior; package publication and SDK release tags remain outstanding.

Ordinary Call idempotency must not be extrapolated to Capability Query. Current OpenAPI has neither a Resolve path nor Query idempotency/lookup semantics.

### #436 — Published ordinary Call recovery

[Issue](https://github.com/QVerisAI/qveris-agent-toolkit/issues/436) is the concrete P1 follow-up for optional `Idempotency-Key` on `/tools/execute` and read-only `/tools/executions/by-idempotency-key` lookup. It requires SDK/CLI/MCP alignment, typed results, deterministic failure fixtures and documentation while preserving paid single-submit. This cleanup creates the implementation task; it does not implement that feature.

### #164 — Triggers/webhooks stay blocked

[Issue](https://github.com/QVerisAI/qveris-agent-toolkit/issues/164) records a fresh contract check. No trigger/subscription/webhook lifecycle or delivery/signature contract is public. Do not implement guessed endpoints, event schemas, forwarding behavior or CLI commands.

## Verification and scope

The original six issue bodies, discussion evidence, merged implementation/release PRs and external directory PR states were reviewed. Two old umbrellas are closed, four original issues remain open, and one focused implementation issue was created. No external maintainer message, marketplace publication, runtime deployment, credential change or paid request was performed.
