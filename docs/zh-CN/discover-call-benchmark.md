# Discover → Call 准确率评测

QVeris 评测完整的 Agent 工作流，而不是只使用无法验证的形容词，或只对搜索相关性打分。公开评测工具位于
[`benchmarks/discover-call`](../../benchmarks/discover-call/README.md)。

本评测的范围限定在契约层：对公开 discover → inspect → call 工作流做确定性打分，每次发版可复跑，
任何持有 API Key 的人都能复现。长周期专业任务、judged 打分的领域级评测是另一套仪器，刻意不纳入
本工具的范围。

## 方法

每个任务和模型 trial 都按同一流程执行：调用 `discover`，让模型从实际返回结果中选择能力，调用
`inspect`，让模型根据当前参数 schema 构造参数，并在启用执行时完成真实 `call`。

评分分别报告选择是否来自 discover、inspect 是否确认同一能力、必填参数完整率、任务约束准确率、
call 成功率、结果有效率，以及严格的端到端工作流成功率。成功的 call 还必须返回非空结果，才能
通过结果有效性与严格工作流门槛。工作流成功要求全部分项通过，因此不能用 dry run 生成。汇总
同时给出 95% Wilson 区间，以及经过安全归类的失败阶段和原因计数。
`429` 和 `503` 瞬时响应会先按客户端语义重试；重试耗尽的 API 失败仍保留在分母中，并按失败阶段
单独报告。

任务集使用语义参数别名，而不是把唯一 tool ID 当作标准答案。这样不会把能够完成同一任务的其他能力
误判为失败，同时仍要求模型的选择来自真实 discovery 响应。Model adapter 只会收到固定 messages
与 response schema，不会得到 scorer 使用的 ground-truth constraints。

v3 任务集在不改变历史 v2 评分契约的前提下，明确支持 `symbol=USD/EUR` 这类组合参数，以及由任务
显式启用的 URL 解码，并提供三条互补的对比基线：

- 确定性的 Oracle lane 只会在固定查询 Top 10 中出现预设有效候选时选择它，用于衡量当前平台上限；
- pinned-model lane 固定不可变模型和 adapter 配置，用于纵向观察版本变化；
- current-model lane 使用当前推荐模型，用于观察当前能力。

Oracle 与模型的严格工作流成功率之差就是 routing gap。还需要结合各分项指标和失败原因，判断损失
来自 discovery 覆盖、模型路由、参数构造、执行，还是结果有效性。

## 可复现要求

公开结果必须保留失败样本，每个任务至少执行三个 trial，注明不可变的模型版本与 adapter revision，
记录 toolkit commit，并同时提交原始 JSONL 与生成的汇总文件。API Key、访问令牌和原始 provider
错误正文不得进入公开结果。

## 已发布结果

首次受控结果于 2026-07-23 运行，使用 `gpt-5.6-sol`、medium reasoning effort、
Codex CLI 0.144.1、`tasks/v2.jsonl`，每个任务执行三个 trial。54 个 trial 均启用了真实执行，
所有失败均保留在分母中。

| 指标 | 结果 |
| --- | ---: |
| 完成参数化并执行 | 50 / 54 |
| 选择来自 discover | 100% |
| inspect 确认同一能力 | 100% |
| 必填参数完整率 | 100% |
| 任务约束准确率 | 75.93% |
| 已尝试 call 的成功率 | 88.00%（44 / 50） |
| 严格工作流成功率 | 64.81%（35 / 54） |
| 工作流成功率 95% Wilson 区间 | 51.48%–76.18% |

call 成功率和工作流成功率的分母不同：严格工作流成功率包含全部 54 个 trial，并要求前置评分项
全部通过。4 个 trial 在模型参数化阶段失败，另有 6 个参数格式有效的 call 返回
`success: false`。其他约束未命中包括：当前 v2 别名评分器没有把有效的组合货币对拆成基础/报价
货币、新闻查询值经过 URL 编码，以及选择了无法接收目标城市的时区列表能力。

完整的[结果说明、不可变 revision、原始 JSONL 与生成汇总](../../benchmarks/discover-call/results/README.md)
均已公开。scorer fixture 仍只用于测试，不代表产品性能。
