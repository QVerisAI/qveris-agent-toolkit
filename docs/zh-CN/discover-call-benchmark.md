# Discover → Call 准确率评测

QVeris 评测完整的 Agent 工作流，而不只对搜索相关性打分。公开评测工具位于
[`benchmarks/discover-call`](../../benchmarks/discover-call/README.md)。

本评测限定在契约层：对公开 discover → inspect → call 工作流进行确定性打分和真实执行。长周期、
依赖人工判断的领域级评测属于另一套评测体系。

## 方法

每个任务和 trial 都按同一流程运行：调用 `discover`，让 adapter 从实际返回结果中选择能力，调用
`inspect`，让 adapter 根据当前 schema 构造参数，最后执行真实 `call`。

评分分别报告选择与检查是否有真实返回依据、必填参数完整率、任务约束准确率、call 成功率、结果结构
是否非空，以及严格的端到端工作流成功率。“结果非空”不代表语义正确。Dry run 不计为工作流成功。
95% 区间使用 task-cluster bootstrap，以任务为重采样单位，避免把同一任务的重复 trial 当作独立任务。

任务集使用语义参数别名，而不是把唯一 tool ID 当作标准答案。模型 adapter 只接收固定 messages 和
response schema，不会得到 scorer 使用的 ground-truth constraints。

对比 lane 的含义如下：

- `reference`：curated reference route。仅当预设候选出现在本次 Top 10 中时才使用；它只代表这些
  精选候选，不代表平台所有可能路径。
- `configured-model`：当 provider 没有可核验的不可变模型 revision 时，记录模型、CLI、reasoning、
  adapter 和任务集配置。
- `pinned-model`：仅用于可核验的不可变 provider 模型 revision；runner 强制要求
  `--model-revision`。
- `current-model`：在同一任务契约下使用当前推荐模型。

reference 与模型的严格工作流成功率之差称为 **strict benchmark gap**。它不自动等于纯路由差异：
顺序执行的 lane 可能观察到不同的实时目录快照，因此必须同时查看分项指标、失败原因、API revision
和目录观察摘要。

## 可复现与公开策略

公开结果保留所有失败 trial，每个任务至少运行三次，并记录模型标识与 provider revision（或
`unreported`）、adapter 与 toolkit revision、任务集摘要、runtime、API revision、服务端有返回时
的 catalog revision、catalog observation 摘要、endpoint 和 discovery limit。

仓库只提交脱敏后的 JSONL。公开 artifact 不包含 execution、search、connection 标识、原始参数值，
也不包含完整有序 discovery 目录。已批准的 selected tool ID 可以保留；其他 selected tool 只保留
摘要。参数质量仅以必填参数完整率和任务约束准确率证明的形式公开；inspect 返回的参数名也会移除，
避免已哈希工具泄露 schema 细节。详见
[公开策略](../../benchmarks/discover-call/PUBLICATION_POLICY.md)。

## 已发布结果

正式 v4 基线于 2026-07-23 运行：18 个不可变任务，每个任务三个 trial，并启用真实调用。

| 指标 | Curated reference route | `gpt-5.6-sol` configured model |
| --- | ---: | ---: |
| 完成参数化并执行 | 51 / 54 | 51 / 54 |
| 任务约束准确率 | 94.44% | 88.89% |
| call 成功且结果非空 | 100%（51 / 51） | 88.24%（45 / 51） |
| 严格工作流成功率 | 94.44%（51 / 54） | 77.78%（42 / 54） |
| 工作流成功率 95% task-cluster bootstrap | 83.33%–100% | 55.56%–94.44% |

strict benchmark gap 为 16.66 个百分点。reference 的三次失败均为东京时区目录覆盖缺口。configured
model 的 12 次严格失败包括：三次东京约束未命中、三次 IP lookup 调用失败、三次 company profile
调用失败，以及三次安全归类的 `tool_use_rejected` adapter 失败。

configured lane 使用 `gpt-5.6-sol`、medium reasoning 和 Codex CLI 0.144.1。provider 模型
revision 为 `unreported`，因此不会称为 pinned model snapshot。两个 lane 都观察到 API revision
`2026-07-22.1`；API 未报告 catalog revision，且两次独立运行的 catalog observation 摘要不同。

较早的 v3 只保留为 diagnostic baseline。其三次 Bitcoin 调用通过 provider 特定的 `id=1` 成功返回，
但 v3 错误地将其计为约束失败。不可变 `tasks/v4.jsonl` 已明确识别该映射，v4 的三次 Bitcoin trial
全部通过。

完整的[结果说明、revision、脱敏 JSONL 与生成汇总](../../benchmarks/discover-call/results/README.md)
均已公开。scorer fixture 仍只用于测试，不代表产品性能。
