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
call 成功率，以及严格的端到端工作流成功率。工作流成功要求全部分项通过，因此不能用 dry run
生成。汇总同时给出 95% Wilson 区间。
`429` 和 `503` 瞬时响应会先按客户端语义重试；重试耗尽的 API 失败仍保留在分母中，并按失败阶段
单独报告。

任务集使用语义参数别名，而不是把唯一 tool ID 当作标准答案。这样不会把能够完成同一任务的其他能力
误判为失败，同时仍要求模型的选择来自真实 discovery 响应。Model adapter 只会收到固定 messages
与 response schema，不会得到 scorer 使用的 ground-truth constraints。

## 可复现要求

公开结果必须保留失败样本，每个任务至少执行三个 trial，注明不可变的模型版本与 adapter revision，
记录 toolkit commit，并同时提交原始 JSONL 与生成的汇总文件。API Key、访问令牌和原始 provider
错误正文不得进入公开结果。

## 已发布结果

当前尚未发布正式模型结果。仓库中的 scorer fixture 仅用于验证评分器，不代表产品性能。首次受控运行
会先提交原始记录与完整方法元数据，之后才会对外使用准确率数字。
