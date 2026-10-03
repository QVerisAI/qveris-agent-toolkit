# Proposed issue-body updates

Internal review draft, checked 2026-10-03. These changes have not been posted. Preserve original goals/non-goals when replacing the status sections below. Keep issues open while external acceptance remains incomplete.

## #200 — Status audit and Phase 2

Phase 0 已由 #226 / #231 完成，Phase 1 已由 #227 / #250 完成。Phase 2 的 JS/Python `AgentDelegationCredentialProvider` 已在 #294 合并（2026-08-10），客户端实现不再受缺少公开交换契约阻塞。

Phase 2 已实现受众/scope 绑定、约束收窄、短期不可刷新凭证、内存缓存、并发交换合并与凭证安全错误。付费 Call 和 CAP Query 保持单次提交，不因 401、限流、重定向或网络异常自动重放。维护分支进一步补充缓存容量、过期清理与 `clear()` 并发保护，合并后记录对应 PR。

- [x] JS/Python delegation 客户端与确定性成功/失败 fixtures（#294）。
- [x] audience/scope/约束收窄、内存保存、不可刷新与付费单次提交。
- [x] `AgentDelegationCredentialProvider`。
- [ ] 已登记 confidential test client 的真实部署验收。
- [ ] 可选 Workload provider（另行评估，保持原范围）。

真实验收仍需已登记 confidential test client，覆盖成功、过期、错误 audience 与 revoke/introspection。单元测试不能代替真实 Resource Server 验证；parent issue 及总体验收“Agent 只获得短期最小权限 token”保持打开。

Evidence: [merged #294](https://github.com/QVerisAI/qveris-agent-toolkit/pull/294).

## #228 — Replace blocked introduction and split acceptance

Parent: #200。Agent Delegation 客户端已通过 #294 合并。当前跟进范围为已登记 confidential test client 的真实部署验收与维护回归。

客户端边界：RFC 8693 交换、endpoint/audience/scope 校验、约束收窄、短期不可刷新凭证、内存保存、subject/scopes 缓存分区与并发交换、响应流大小限制和凭证安全错误。付费操作不自动重试或回退到 API Key。

- [x] JS/Python provider 实现、导出、文档与确定性失败回归（#294）。
- [x] endpoint/audience/scope、有效期、响应大小与约束扩大拒绝测试。
- [x] token/client secret 不持久化，错误输出不包含凭证。
- [x] API Key 和 Device Flow provider 回归。
- [ ] 已登记 confidential test client：真实成功交换与资源调用。
- [ ] 真实过期与错误 audience 拒绝。
- [ ] revoke/introspection 或等价失效策略验收。
- [ ] 记录环境、日期与不含凭证的结果后关闭 issue。

Do not treat synthetic fixtures as proof of live Resource Server enforcement. Preserve existing non-goals.

## #293 — Replace obsolete startup status

Public OpenAPI `2026-09-21.1` 已发布 `GET /capabilities/{capability_id}` 与 `POST /capabilities/query` 及 projection fixtures。维护分支已实现 JS/Python typed Detail/Query，仍需合并与发布；请求、模型与付费单次提交测试以公开契约为依据。

Resolve、selection token/expiry/freshness、幂等键与精确 execution lookup/reconciliation 尚无完整公开契约，继续 blocked。Query 的 `max_credits` 是预算上限，不是保留报价；未知结果不能自动重放。

- [x] Published Detail/Query paths and current projection fixtures.
- [ ] Merge/release maintenance branch Detail/Query clients.
- [ ] Publish Resolve constraints and deterministic selection/quote semantics.
- [ ] Publish selection token, expiry, contract/schema binding and freshness errors.
- [ ] Publish idempotency and exact execution lookup/reconciliation.
- [ ] Provide current/N-1 acceptance fixtures for future Resolve/selection behavior.
- [ ] After merge, record implemented transport/contract matrix; retain future Resolve/selection acceptance rows unchecked.

CLI/MCP Capability entry points remain outside this completed scope until consistent typed execution/recovery is possible. Preserve the original non-goals and #273 link.

## #368 — Dated acceptance checklist

Evidence is historical unless explicitly rechecked 2026-10-03. Accepted submission does not imply fresh runtime health verification.

- [x] Gemini Gallery: [acceptance, 2026-09-10](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5615591720), public Gallery URL and tagged manifest validation.
- [ ] Cursor Marketplace: source preparation complete; submission/acceptance evidence required.
- [x] Glama: [health acceptance, 2026-09-14](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5661792968), [TDQS A (4.2/5), 2026-09-15](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5674518915). Live health not revalidated this run.
- [ ] Local Awesome MCP: [#14435](https://github.com/punkpeye/awesome-mcp-servers/pull/14435) OPEN, rechecked 2026-10-03.
- [x] Remote Awesome MCP: [#184](https://github.com/punkpeye/awesome-remote-mcp-servers/pull/184) merged 2026-09-15; state rechecked 2026-10-03.
- [x] Smithery: [hosted listing acceptance, 2026-09-14](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5662986753); current runtime verification remains separate.
- [x] mcpservers.org: [searchable listing acceptance, 2026-09-14](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5662216502).
- [x] AI plugins: [#266](https://github.com/hashgraph-online/awesome-ai-plugins/pull/266) merged 2026-09-14; state rechecked 2026-10-03.
- [x] TensorBlock: [#2276](https://github.com/TensorBlock/awesome-mcp-servers/pull/2276) merged 2026-09-10; state rechecked 2026-10-03. [Install acceptance record](https://github.com/QVerisAI/qveris-agent-toolkit/issues/368#issuecomment-5615504328).
- [ ] mcp.so: submitted; public ingestion/install verification pending.

Preserve original acceptance criteria and “Already covered”. Keep release-version/install freshness checks separate from historical submissions.
