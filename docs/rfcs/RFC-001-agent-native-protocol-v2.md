# RFC-001：QVeris Agent-Native 集成协议 v2

| | |
|---|---|
| **状态** | **Draft v0.2（评审后修订）：M1 继续推进；M2–M4 冻结为研究轨** |
| **日期** | 2026-07-06 |
| **作者** | linfangw |
| **评审** | @ax2、@buxibuxi、toolkit maintainers |
| **关联** | 上游服务端 issue（数据/覆盖、路由检索质量；私有跟踪）· 基准评测报告与集成层优化方案（内部设计文档，私有 tracker） |

**摘要**：现有 Discover/Inspect/Execute 是能力数据库的 CRUD 视图，不是 agent 决策循环的协议表面。本 RFC 提出 v2 协议：三级渐进披露（L0 路由卡 / L1 调用卡 / L2 完整契约）、新增 Probe 查证动词、Execute 意图化返回与"恢复程序"错误、Toolbelt 工具带与 MCP 原生化、探索产物可编译为确定性 lockfile。全部变更 additive-first：**已发布半年的现有接口默认行为零变化**，新能力显式 opt-in，弃用项走 6 个月三阶段 Sunset。验收以金融基准回归为准：首调成功率 60%→≥90%，token/任务 −70%，"日常研究"画像判定 wash→wins。

---

## 评审结论与状态变更（2026-07-06，v0.2）

独立架构评审（对抗性、基于原始数据逐条核查）裁决为"需要重大返工（非否决）"，本版按评审采纳以下变更：

**关键核查结论**：

1. 质量提升高度集中于单任务：cli 的 +6.8 去掉宁德时代任务后塌缩至 +0.5；裁判 holistic 口径 lift 仅 +0.8/+3.6。真实提升表述为**未知区间 [+0.8, +10.4]**，点值暂停引用。
2. 实测任务级失败 100% 在服务/数据侧（429/覆盖/发现），参数格式类任务失败为零——本 RFC 部分投入原瞄准了低发生率失败模式。
3. 遥测喂养主张（P3）的数据地基当前不存在：全基准仅 ~80 次调用，执行服务端尚无调用级遥测；距挖掘管线最低流量门槛差 1–2 个数量级。
4. 用未验证的基准（golden 0/50、仪器验证项未签署）同时做诊断与验收构成循环论证。

**状态变更**：

- **M1 三项继续**（服务端投影 / 429 退避 / MCP 瘦身；对应上游服务端 issue 不变）——证据充分、可逆、低风险。
- **新增 M0 阻断项**（测量仪器修复）：golden 每类 ≥1 条人工验证、仪器验证项签署闭环、3 随机种子 + claude 第二 agent 复测、发布规则分 vs 裁判分歧表。
- **M2–M4 冻结为研究轨**，解冻条件：M0 完成 + OQ-1/2/3 确认 + 执行服务端具备调用级遥测 + 生产流量 ≥1 万次调用/月。
- **本迭代不冻结协议版本、不启动 Sunset 时间表**（第七章保留为设计预案）。
- 路线图重心回移至上游数据/覆盖侧 issue 与产品定位（"难获取/新鲜/多源数据的经纪层"）。

正文保留 v0.1 原文供评审对照；与本节冲突处以本节为准（下文关键处已加"评审修正"标注）。

## 一、动机与证据

以下每条均有基准实测或代码级证据支撑（完整数据见关联文档）：

- **成本结构性失衡**：QVeris 变体质量提升 +6.8/+9.4（校准裁判口径），但成本 3–4.5 倍、延迟 +28%~41%。主因是工具原始输出全量注入 agent 上下文（单次最大 140.7k 字符）并被多轮对话平均放大 **4.7 倍**计费。
- **首调成功率仅 60%**：参数错误类型高度集中（数字写成字符串、日期格式、公司名 vs 代码、漏必填——`agent/GUIDELINES.md:163-181` 已完整总结），但这些知识不在协议里，每个 agent 每个会话重新试错。
- **Inspect 零增量信息**：返回内容是 Discover 的字段重复；官方 skill 将其标注为"可选"，生态用脚投票。
- **Discover 承担运行时路由却按数据库行导出设计**：每条结果携带全量 params/examples/billing_rule/stats；MCP 路径默认 20 条 + 每轮重注入约 2.7k token 工具 schema。中文语义检索不稳定（上游路由检索质量 issue），生产 agent 已用"钉死 tool_id 跳过发现"自救。
- **MCP 元工具间接层削弱 function-calling**：agent 通过通用 call 元工具间接调用真实工具，模型无法利用按具体工具 schema 训练的 function-calling 能力。**评审修正（v0.2）**：原稿所称"双重 JSON 编码"仅适用于 OpenClaw 插件路径；被测 MCP 路径传递真实对象，且实测零参数格式类任务级失败（60% 首调成功率的代价体现为重试轮次，而非任务失败）。间接层批评方向仍成立，强度下调。
- **两类消费者被同一套接口勉强服务**：程序化确定性调用（vibe-coding/APP）需要稳定契约、codegen、幂等与版本语义；探索性 agent 调用需要渐进披露、查证、恢复引导。现状对两者都是次优。

> **核心主张**：agent-native 不是"给 LLM 加接口"，而是让每个协议表面恰好回答 agent 决策循环中当前环节的那一个问题；工具的"怎么调对"知识应由平台的执行遥测自动喂养（经纪层独有资产）；探索的产出必须能编译为确定性配置。

## 二、设计原则与术语

### 2.1 设计原则

- **P1 决策环节对齐**：agent 工具使用是固定循环——识别需求 → 找候选 → 查证适配 → 构造调用 → 消费结果 → 错误恢复 → 沉淀记忆。每个环节对应恰好一个协议表面。
- **P2 渐进披露与 token 预算**：信息按 L0/L1/L2 三档分层，每档在协议层承诺 token 预算上限，预算是接口契约的一部分。
- **P3 遥测喂养**：调用知识（成功参数模板、错误→修法、实测覆盖）由执行遥测自动挖掘生成，持续新鲜。**评审限定（v0.2）**：此原则以数据地基为前提——当前平台不记录调用级参数/负载，流量距挖掘门槛差 1–2 个数量级；门槛达成前，由此驱动的设计均属研究轨。
- **P4 诚实的不确定性**：所有派生结论必须携带三值判定（是/否/未知）、证据来源（schema_only/observed/catalog/live）与 as_of 时间戳。
- **P5 探索编译为确定性**：探索产物可一键固化为 lockfile，确定性通道运行时零发现、零元工具。
- **P6 additive-first 兼容**：已发布接口默认行为零变化；新能力显式 opt-in；破坏性变更仅限已事实死亡的形态且走完整 Sunset 周期（第七章）。

### 2.2 术语

| 术语 | 定义 |
|---|---|
| L0 路由卡 | 约 60–80 token/工具的选择用摘要：能力一句话、覆盖标签、新鲜度、成本档、可靠性档 |
| L1 调用卡（Skill 卡） | 约 300–800 token/工具的正确调用知识：意图配方、参数守则、错误→修法、实测覆盖、响应预览 |
| L2 完整契约 | OpenAPI 片段级完整定义：全参数 schema、响应 schema、计费规则、SLA、semver 与变更日志 |
| 覆盖键（coverage_keys） | 工具元数据声明的、决定"有没有数据"的低基数参数维度（如 symbol、market）；range_keys 为区间维度 |
| 结果分类法 | 对每次执行结果的标准化分类枚举（5.3），覆盖索引与恢复程序的共同地基 |
| 恢复程序 | 错误响应中机器可执行的下一步指令：fix_params（含补丁）/ switch_tool（含替代）/ backoff / give_up |
| 工具带（Toolbelt） | 服务端命名资源：一组 tool pin + 参数模板 + 路由提示，版本化、可共享；MCP server 可加载并原生暴露包内工具 |
| qveris.lock | 确定性场景锁定文件：tool_id@version + 参数模板 + 响应投影 + contract_hash |

## 三、协议总览

### 3.1 端点映射（新旧对照）

| 决策环节 | v1 现状 | v2 表面 | 变更类型 |
|---|---|---|---|
| 找候选 | POST /search（全量行导出） | POST /search + `view=routing`（L0 卡） | 参数级 additive |
| 查证适配 | **缺失** | **POST /tools/probe**（新） | 新端点 |
| 学会调用 | POST /tools/by-ids（重复 discover） | POST /tools/by-ids + `level=usage`（L1 卡） | 参数级 additive + 响应加块 |
| 深度契约 | 散在 openapi.json | **GET /tools/{id}/contract**（L2，新） | 新端点 |
| 执行 | POST /tools/execute（透传） | 同端点 + `respond_with` / `autofix`；响应加 `meta`/`recovery` | 参数与响应块 additive |
| 沉淀记忆 | **缺失**（客户端各自造轮子） | **/toolbelts** 资源族（新）+ qveris.lock 规范 | 新资源 |

### 3.2 双场景旅程

**探索通道（专业 agent）**：discover(view=routing) 取 5 张 L0 卡 → 选定候选 inspect(level=usage) 取 L1 调用卡 → probe 查证覆盖与报价 → execute(respond_with=summary) → 失败按 recovery 执行 → 良好组合存为 toolbelt。全程 token 预算：发现环节 ≤1k，学习环节 ≤1.6k。

**确定性通道（vibe-coding / APP）**：设计时探索一次 → `qveris pin tool_id@version` 写入 qveris.lock → SDK codegen 强类型客户端 → CI 中 probe --check contract 防契约漂移 → **运行时是普通强类型 HTTPS 调用，零发现、零元工具、零 LLM 参与**。

两通道共享同一能力后端，桥梁是 lockfile：探索硬化为确定性——这正是两个生产 agent 手工走过并验证的路径，本 RFC 将其产品化。

## 四、详细设计 A：Discover v2 与 Inspect v2

### 4.1 Discover v2：L0 路由卡

`POST /search` 新增可选参数 `view: "routing" | "full"`（默认 `full` = 现状，零影响）与 `lang`（默认按 Accept-Language）。`view=routing` 每条结果：

```json
{
  "tool_id": "ths_ifind.history_quotation.v1",
  "capability": "A股/港股历史日线行情（OHLCV、复权）",
  "coverage": ["CN", "HK"],
  "freshness": "T+0 收盘后",
  "cost_class": "low",
  "reliability": "A",
  "as_of_support": true,
  "search_id": "s-7f3a"
}
```

每条 ≤80 token；limit=5 时整响应 ≤800 token，预算写入契约。字段来源：capability 为人工审核的一句话能力描述（新增元数据字段）；coverage/freshness 来自元数据 + 目录同步校核；cost_class 由计费规则映射三档；reliability 由近 30 天遥测成功率分档（A ≥97% / B ≥90% / C）。routing 视图不含参数 schema、示例、计费明细。结构化 coverage 标签同时为检索提供硬过滤维度，降低语义漂移敏感性（关联上游路由检索质量 issue）。

### 4.2 Inspect v2：L1 调用卡

`POST /tools/by-ids` 新增可选参数 `level: "usage" | "full"`（默认 `full` = 现状）。`level=usage` 返回调用知识：

```json
{
  "tool_id": "ths_ifind.history_quotation.v1",
  "version": "v1",
  "recipes": [
    {
      "intent": "查询A股个股一段时间的日线",
      "params": {"symbol": "600519.SH", "start_date": "2026-01-01", "end_date": "2026-06-30", "adjust": "qfq"},
      "verified": {"by": "telemetry", "success_rate": 0.99, "sample_n": 812, "as_of": "2026-07-05"}
    }
  ],
  "param_rules": [
    "symbol 必须带交易所后缀：沪 .SH / 深 .SZ / 港 .HK（无后缀调用历史成功率 4%）",
    "日期格式 YYYY-MM-DD；start_date 早于 2005-01-01 时返回空",
    "adjust 枚举：qfq | hfq | none，默认 none"
  ],
  "error_fixes": [
    {"error_class": "SUCCESS_EMPTY.UNKNOWN_KEY", "fix": "检查 symbol 后缀；A股六位代码 + .SH/.SZ", "fix_success_rate": 0.91},
    {"error_class": "RATE_LIMITED", "fix": "读响应 retry_after 秒后重试", "fix_success_rate": 0.99}
  ],
  "observed_coverage": {
    "markets": ["CN", "HK"],
    "distinct_keys_ok": 8412,
    "observed_range": {"min": "2005-01-04", "max": "2026-07-04"},
    "as_of": "2026-07-05"
  },
  "response_preview": {
    "schema": "list[{date, open, high, low, close, volume, amount}]",
    "sample": [{"date": "2026-07-04", "open": 1688.0, "close": 1695.2, "volume": 2183400}],
    "sample_captured_at": "2026-07-04"
  },
  "prerequisites": ["QVERIS_API_KEY"],
  "usage_card_revision": "2026-07-05T02:00Z"
}
```

**字段生成来源（遥测挖掘管线）**：

| 字段 | 生成方式 | 刷新 |
|---|---|---|
| recipes | 历史成功调用参数集聚类取头部模式；intent 短语由 LLM 离线生成、人工抽检；参数值取最近成功样本（脱敏） | 日批 |
| param_rules | (a) schema 充实（成功参数值模式归纳）；(b) 失败/成功参数差分统计（量化守则） | 日批 |
| error_fixes | 挖掘同会话"失败→改参→成功"相邻调用对，diff 即修法，按 error_class 聚合统计修复成功率；冷启动由 GUIDELINES 人工清单托底 | 日批 |
| observed_coverage | 直接读覆盖索引（5.4，与 probe 共用） | 近实时 |
| response_preview | 范例库（代理层截留最近成功响应首行 + schema 推断，复用现有 content_schema 机制） | TTL 7 天 |

**冷启动降级**：recipes 回退供应商文档 examples（标注 `verified.by: "provider_doc"`）；error_fixes 回退同供应商通用修法（标注 `scope: "provider_generic"`）；observed_coverage 标注 `"unknown"`。宁可字段缺失并如实标注，不许无根据填充（P4）。

**与 v1 的关系**：`level=full` 完整保留现状响应（含 additive 的 usage 块）；免费属性不变。

## 五、详细设计 B：Probe 查证端点

### 5.1 接口定义

```json
POST /tools/probe?tool_id=...
{
  "parameters": {"symbol": "MBG.DE", "period": "annual", "limit": 2},
  "checks": ["schema", "coverage", "quote", "sample"],
  "live_budget": "none"
}
```

响应（基准中真实翻车的 FMP/MBG.DE 案例在 v2 下的结局）：

```json
{
  "schema":   {"valid": true},
  "coverage": {
    "verdict": "not_covered",
    "verified_by": ["catalog", "observed"],
    "as_of": "2026-07-05",
    "detail": "供应商符号目录未收录 MBG.DE；近90天该键 3 次调用全部 SUCCESS_EMPTY.UNKNOWN_KEY",
    "observed_range": null
  },
  "quote":    {"estimate_usd": 0.004, "basis": "per_call", "range_p50_p95": [0.004, 0.004]},
  "recovery": {
    "kind": "switch_tool",
    "alternatives": [{"tool_id": "eodhd.eod.retrieve.v1", "coverage_evidence": "observed:MBG.DE 成功 37 次"}],
    "confidence": 0.87
  }
}
```

- `live_budget`：`none`（默认，零成本层）| `metadata`（允许打供应商免费 meta 端点）| `sampled`（1 行采样真调用，极低象征费用）。probe 永不隐式花钱。
- `coverage.verdict` 三值：`covered | not_covered | unknown`。unknown 是合法答案。

### 5.2 四层实现与成本

| 层 | 回答什么 | 实现基础 | 上游成本 |
|---|---|---|---|
| ① schema 校验 | 参数格式/类型/必填/枚举合法性 | 现有 params[] + 遥测充实的 pattern/format | 零（纯本地） |
| ② 覆盖检查 | 该覆盖键在该工具是否有数据 | 覆盖索引 + 供应商目录同步 + 可选实时轻探 | 零 / 零 / 极低 |
| ③ 采样与响应 schema | 返回长什么样 | 范例库（截留最近成功响应首行 + schema 推断） | 零（缓存） |
| ④ 成本报价 | 这次调用花多少钱 | 计费引擎干跑（pre_settlement 逻辑前移）；大小相关计费用遥测 p50/p95 区间 | 零 |

### 5.3 结果分类法（Outcome Taxonomy，规范性枚举）

分类判定发生在执行代理层的**供应商适配器**内，随执行事件落库。覆盖索引、error_fixes、恢复程序共用。

| 类 | 子类 | 判定依据 | 对覆盖索引的语义 |
|---|---|---|---|
| SUCCESS_WITH_DATA | — | 2xx 且数据体非空 | 覆盖 +1，更新 observed_range |
| SUCCESS_EMPTY | UNKNOWN_KEY | 2xx 空数据，供应商信号表明键不识别（或目录确认未收录） | 强不覆盖信号 |
| SUCCESS_EMPTY | OUT_OF_RANGE | 2xx 空数据，键已知但请求区间在 observed_range 外 | 不改覆盖判定，补区间边界证据 |
| SUCCESS_EMPTY | NO_MATCH | 2xx 空数据，过滤条件无命中 | 中性 |
| SUCCESS_EMPTY | AMBIGUOUS | 无法区分上述三种 | 只计数不判定 |
| CLIENT_PARAM_ERROR | — | 4xx 参数类拒绝（400/422） | 不计入覆盖；喂 error_fixes |
| AUTH_ERROR | — | 401/403 | 不计入 |
| RATE_LIMITED | — | 429（记录 retry_after） | 不计入；喂退避统计 |
| PROVIDER_ERROR | — | 上游 5xx | 不计入覆盖；喂 reliability 分档 |
| PROVIDER_TIMEOUT | — | 上游超时 | 同上 |
| TRUNCATED_SUCCESS | — | 成功但触发 max_response_size 截断 | 按 SUCCESS_WITH_DATA 计，另计截断率 |
| BROKER_ERROR | — | 经纪层自身故障 | 不计入任何工具统计 |

> **UNKNOWN_KEY 与 NO_MATCH 的区分是覆盖索引正确性的命门**：判定优先级为供应商显式错误码/消息 > 目录比对 > 同键其他参数的历史成功记录；无法区分落 AMBIGUOUS。此分类法与基准归因引擎的七类根因存在映射；服务端落地后基准侧应改为直接消费服务端分类。

### 5.4 覆盖索引存储 schema（规范性）

```sql
TABLE coverage_index (
  tool_id            TEXT,      -- 含版本的完整工具 id
  ckey_hash          BYTES,     -- 归一化覆盖键哈希
  ckey_display       TEXT,      -- 原文，如 "symbol=MBG.DE"
  n_success          INT,
  n_empty_unknown    INT,       -- SUCCESS_EMPTY.UNKNOWN_KEY
  n_empty_other      INT,       -- OUT_OF_RANGE + NO_MATCH + AMBIGUOUS
  n_error            INT,       -- 4xx/5xx 合计（诊断用）
  last_success_at    TIMESTAMP,
  last_outcome       TEXT,
  range_min          DATE,      -- range_keys 观测下界
  range_max          DATE,
  catalog_status     TEXT,      -- present | absent | unknown（目录同步写入）
  catalog_as_of      DATE,
  updated_at         TIMESTAMP,
  PRIMARY KEY (tool_id, ckey_hash)
)
-- 归一化：按工具元数据声明的 coverage_keys 提取参数子集，值做大小写/空白归一，
--         多键按键名排序拼接后哈希。
-- 判定函数（读路径）：
--   catalog_status=absent 或 (n_empty_unknown≥3 且 n_success=0) → not_covered
--   n_success≥1 或 catalog_status=present                      → covered（附 as_of）
--   其余                                                        → unknown
```

**写路径**：执行事件流 → 适配器 outcome 分类 → 覆盖键提取（工具元数据新增 `coverage_keys`/`range_keys` 声明；Top 工具一次性人工治理，长尾按参数名启发式 + unknown 兜底）→ 幂等 upsert。**时效性**：判定携带 as_of；covered 判定加 90 天新鲜度窗（超窗降级 unknown）；退市/下架靠目录同步日批矫正。

### 5.5 与执行日志的对接点（待执行服务端 owner 确认）

基于公开契约可确定的锚点撰写；内部字段名以执行服务端实际 schema 为准（对应 OQ-1/2）：

| # | 对接点 | 公开契约锚点 | 需确认 |
|---|---|---|---|
| 1 | 每次执行已有唯一记录 | 响应含 execution_id；usage_history 可回查 | 是否持久化**参数原文**与响应体/摘要 |
| 2 | 空/错分类现状 | 响应含 success 布尔与 status_code | 适配器层是否已区分空数据与错误；5.3 落地最低成本模块 |
| 3 | 响应 schema 推断雏形 | 截断信封携带 content_schema | 推断逻辑能否常态化为范例库管线；截留样本存储与脱敏 |
| 4 | 计费引擎可干跑 | 响应含 pre_settlement_bill | 定价计算与执行是否解耦；大小相关计费占比 |
| 5 | 事件流基础设施 | — | 执行日志是流（可订阅）还是仅落库；日批 vs 流式聚合约束 |

## 六、详细设计 C：Execute v2、Contract 与 Toolbelt

### 6.1 Execute v2

端点不变，请求新增可选参数：

- `respond_with`：`full`（默认 = 现状）| `fields:$.data.close,$.data.date`（JSONPath 白名单投影）| `summary`（schema + 统计摘要 + 首 N 行 + 全量落盘 URL）| `aggregate:{spec}`（服务端聚合）。服务端投影同时省下行带宽与 agent 上下文。
- `autofix`：默认 `false`。true 时服务端可应用高置信度参数归一化，**必须在 meta.autofixed 完整披露改动**；计费按修复后实际调用计。

成功响应（additive，原字段不动）：

```json
{
  "execution_id": "e-9c21",
  "data": {"symbol": "600519.SH", "rows": 120, "close_last": 1695.2},
  "meta": {
    "cost_usd": 0.004, "latency_ms": 412, "truncated": false,
    "autofixed": null, "provider": "ths_ifind", "as_of": "2026-07-04"
  }
}
```

错误响应升级为恢复程序（recovery 为 additive 新块）：

```json
{
  "error": {
    "class": "SUCCESS_EMPTY.UNKNOWN_KEY",
    "message": "provider returned no data for symbol MBG.DE",
    "recovery": {
      "kind": "switch_tool",
      "patch": null,
      "alternatives": [{"tool_id": "eodhd.eod.retrieve.v1", "coverage_evidence": "observed:37 ok"}],
      "confidence": 0.87,
      "source": "telemetry:error_fixes"
    }
  }
}
```

`recovery.kind` 枚举：`fix_params`（附 patch）| `switch_tool`（附 alternatives）| `backoff`（附 retry_after_s）| `give_up`（附 reason）。内容与 L1 卡 error_fixes 同源。

### 6.2 Contract：GET /tools/{id}/contract（L2）

返回单工具 OpenAPI 3.1 片段：完整参数 JSON Schema（含遥测充实）、响应 schema、错误枚举、计费规则、SLA、semver 与变更日志。附加 `contract_hash`（参数+响应 schema 稳定摘要，lockfile 与 CI 契约测试锚点）与 `deprecation`（sunset 日期与迁移目标）。工具版本语义正式化：`tool_id@version` 可寻址历史版本；破坏性变更必须发新 version 并给旧版本 ≥90 天 sunset 窗口。

### 6.3 Toolbelt 与 qveris.lock

```json
POST /toolbelts
{
  "name": "finance-cn-research",
  "revision": 3,
  "tools": [
    {
      "tool_id": "ths_ifind.history_quotation.v1",
      "alias": "cn_history_quote",
      "param_template": {"adjust": "qfq"},
      "respond_with": "summary",
      "routing_hint": "A股/港股历史行情首选"
    }
  ],
  "fallback": {"discover_enabled": true, "max_qveris_failures_before_public": 3}
}
```

- **MCP 原生化（对首调成功率影响最大的单项）**：MCP server 新增 `--toolbelt <name>` 加载模式，把包内工具按 alias 作为**独立 MCP 原生工具**暴露（真实窄 schema），消灭元工具间接层与双重 JSON 编码；通用 `discover/probe` 保留为兜底。默认仍是元工具模式，行为零变化。
- **qveris.lock**：`{tool_id@version, param_template, respond_with, contract_hash}` 数组。`qveris pin` 从探索会话生成；CI 中 `qveris probe --check contract` 比对 contract_hash 防契约漂移。
- Toolbelt 初始内容：收编生态已验证资产（stock-copilot-pro 的 tool-chains.json、tool-evolution.json）为首批官方金融工具带。

## 七、兼容性与版本过渡方案（规范性章节）

前提事实：v1 接口已公开 6 个月以上，存在已知与未知依赖方。**总原则：默认行为零变化（additive-first）；行为翻转只发生在客户端 major/minor 版本内且可回退；删除只针对已事实死亡的形态且走满 Sunset 周期。**

### 7.1 逐表面兼容策略

| 表面 | v2 变更 | 兼容策略 | 破坏性 |
|---|---|---|---|
| POST /search | 新增 view / lang 参数 | 默认 view=full 与现状逐字节一致 | 无 |
| POST /tools/by-ids | 新增 level 参数；full 响应新增 usage 块 | JSON 消费者按契约容忍新增键（公告重申） | 无 |
| POST /tools/probe | 全新端点 | — | 无 |
| POST /tools/execute | 新增 respond_with / autofix；响应新增 meta / recovery | 默认值 = 现状；原字段原样保留（meta 为冗余镜像，v3 前不移除） | 无 |
| GET /tools/{id}/contract | 全新端点 | — | 无 |
| search_id 参数 | 正式声明可选 | **永不移除**：接受即忽略 | 无 |
| MCP 三个废弃别名元工具 | 移除 | 三阶段 Sunset（7.3）；期间照常工作但携带 deprecation 提示 | 有·受控 |
| MCP toolbelt 原生模式 | 新增加载模式 | --toolbelt 显式 opt-in；缺省元工具模式 | 无 |
| CLI 默认输出 | agent 模式默认 full→summary | 仅随 CLI 0.7.0 翻转；--full 回退；0.6.x 维护 6 个月 | 有·客户端版本内 |

### 7.2 版本信号机制

- **不采用 /v2 路径大版本**（理由见 ALT-1）：参数级 opt-in 演进；响应头新增 `X-QVeris-Api-Revision: 2026-07-06`（日期式修订号）；SDK 按修订号声明兼容范围。
- **弃用信号标准化**：REST 响应携带 `Deprecation: true` 与 `Sunset: <RFC 1123 日期>` 头；MCP 别名工具 description 前缀 `[DEPRECATED→迁移目标]` 并在结果 meta 附迁移提示；CLI stderr 一次性警告（可 `QVERIS_NO_DEPRECATION_WARNINGS=1` 关闭）。
- **遥测驱动的定向迁移**：按 API key 统计旧形态使用（仍传 search_id 门槛语义、仍调别名工具、从不带 view/level 的高频 key），对活跃依赖方定向通知（控制台横幅 + 邮件）。**Sunset 执行前置条件：旧形态流量占比 <5%，否则顺延并复盘沟通。**

### 7.3 三阶段过渡时间表

| 阶段 | 窗口 | 动作 | 回退手段 |
|---|---|---|---|
| A · Additive 上线 | T0 ~ T+4 周 | 全部新参数/端点/响应块上线，默认行为零变化；新版客户端发布但默认旧行为；公告与迁移指南；基准双跑出对照报告 | 无需回退 |
| B · 默认翻转 | T+4 ~ T+12 周 | 新版客户端翻转默认（CLI agent 模式默认 summary；MCP 默认瘦身 + limit 5；官方 skill 移除 --discovery-id 门槛）；服务端按 API key 灰度：内部 → 基准 → 5% → 25% → 100%；定向通知旧形态使用者 | 客户端 --full / 环境变量回退；服务端灰度按 key 秒级回滚 |
| C · Sunset 执行 | T+12 ~ T+24 周 | MCP 别名：只警告（T+12）→ 环境变量显式启用（T+18）→ 移除（T+24，MCP 1.0）；CLI 0.6.x 停止维护；<5% 流量门槛检查 | T+18 前可冻结；移除后保留 410 + 迁移文档链接再 3 个月 |

### 7.4 客户端升级矩阵

| 客户端 | 现版本 | 阶段 A | 阶段 B |
|---|---|---|---|
| @qverisai/cli | 0.6.0 | 0.7.0：--summary/--fields/--probe/pin，默认不变 | 0.7.x：agent 模式默认 summary（--full 回退）；0.6.x 维护至 T+24 周 |
| @qverisai/mcp | 0.7.1 | 0.8.0：compact 序列化、usage/probe 元工具、--toolbelt（opt-in）、别名标 deprecated | 0.9.0：默认瘦身 + limit 5；1.0.0：移除别名 |
| Python SDK | 0.2.0 | 0.3.0：probe/contract/toolbelt、429 退避 | 类型化 respond_with；lockfile codegen |
| OpenClaw 插件 | 2026.6.x | 消费 usage 卡（替换自维护 formatToolForModel） | discover 缓存改用 usage_card_revision 失效 |
| 官方 skills | — | 文档更新：probe / pin 流程 | 移除 --discovery-id 硬门槛；内置金融工具带 |

### 7.5 兼容性测试与质量门

- **契约快照双跑**：CI 固化 v1 默认形态响应快照（golden files），阶段 A/B 每次服务端发布回归——additive 承诺机器可验证。
- **基准回归即质量门**：金融基准 smoke（校准裁判口径）每阶段灰度前后各一轮：质量分回退超 ±2 噪声带阻断；token/成本/首调成功率必须朝目标移动。
- **依赖方金丝雀名单**：邀请 2–3 个真实第三方集成加入阶段 B 的 5% 灰度批次。

## 八、度量、验收与分阶段实施

### 8.1 成功度量（金融基准为官方验收装置）

> **评审修订（v0.2）**：下表验收目标暂停生效，直至测量仪器完成验证（M0：golden 每类 ≥1 条、仪器验证项签署、3 种子 + 第二 agent）。用未验证的基准做验收门构成循环论证——"wash→wins"可被评分规则 artifact 移动。lift 基线改为区间 [+0.8, +10.4]；首调成功率 60% 为 cli n=5 数字（mcp 未观测），置信度低。
>
> **M0 复测结果（2026-07-06，批次 m0-codex-3x-20260706）**：3 种子 × 双 rubric × 双打分层复测完成（codex/gpt-5.5@xhigh，45 行原始运行、180 次评分，GLM-5.2 裁判 90/90 真打分零回退）。主口径（rubric v2 + 裁判）lift：**cli +5.7 [+5.0, +6.2]、mcp +5.3 [+4.8, +5.8]**；四种口径（v1/v2 × 规则/裁判）方向全部为正（+2.7 ~ +6.0），剔除单一任务后结论不变，上一行的 lift 区间收窄为该值。规则 vs 裁判分歧表已发布（均值 +3.3 分，最大分歧集中于 baseline 行——规则层高估 baseline 表面完整性，"缺数据惩罚"由裁判层承担并生效）。资源面同批实测：输入 token 123k → 534k（cli，×4.3）/ 723k（mcp，×5.9），墙钟 ×1.56/×1.51；lift 全部来自 B_trust（19.4→25.0），D_efficiency 反降（14.0→12.9/11.1）。**画像加权判定三画像全负**（日常研究 −2.6/−6.0，07-04 单轮的 wash 在更精确数据下降为 loses）——质量提升成立但按当前代价不值，构成 M1 降 token 的直接商业依据；**M1 后复测应以画像判定翻正为验收线，而非仅看质量 lift**。**测量层对 M1 的阻塞解除**。遗留：claude 第二 agent 腿因账号级限流中止（1/45 行），跨 agent 泛化未验证（golden 专家验证已于 2026-07-07 完成回填）。**专家验证后更新（2026-07-07）**：golden 经 5 位专家验证修订后裁判层重评，lift 升至 **cli +11.6 / mcp +9.8**（CI 均不含 0；变动全部来自 baseline −5.9 分——专家把"缺关键交付要素"写成硬要求后 QVeris 差异化价值显性化；测量定义变更于重评前锁定，非事后调参）。对外引用 lift 需注明 golden 世代；专家版为主口径。详见私有基准仓的 M0 报告。

| 指标 | 基线（2026-07-04 smoke 实测） | 目标 | 主要贡献设计 |
|---|---|---|---|
| 首调成功率 | 60%（cli） | ≥90% | L1 卡、probe、恢复程序、toolbelt 原生 MCP |
| 计费输入 token/任务 | 435k（cli）/ 610k（mcp） | ≤130k | 渐进披露、respond_with、MCP 瘦身 |
| 单任务成本增幅 vs baseline | +318% / +450% | ≤+80% | 同上 + 发现环节消除 |
| 发现类调用次数/任务 | 2–3 次 | 0–1 次 | toolbelt、lockfile |
| 画像判定（日常研究） | loses（−2.6/−6.0，M0 三种子复测；07-04 单轮为 wash） | **wins**（商业验收线） | 全部 |
| 空调用浪费拦截率 | 事后归因 | probe 前置拦截 ≥80% | probe 覆盖检查 |

### 8.2 实施分期（v0.2 评审后）

| 期 | 状态 | 内容 | 依赖 / 解冻条件 |
|---|---|---|---|
| **M0（新增·阻断项）** | 🟢 主体完成（2026-07-06） | ✅ 仪器验证项签署；✅ 3 种子复测（codex，主口径极差 ≤1.2 分）；✅ 双 rubric 对照 + 规则 vs 裁判分歧表；✅ golden 专家验证完整闭环（5 专家、一致率 69% + 裁判层重评：专家版口径 lift cli +11.6 [+2.8,+20.4] / mcp +9.8 [+0.6,+19.0]，baseline −5.9 分承担全部变动，自 2026-07-07 起为主口径）；❌ claude 第二 agent 中止（限流），转为遗留项 | 私有基准仓 |
| M1（≈2 周） | ✅ 继续 | probe ①④层；/search view=routing；execute respond_with；429 退避。收益按任务类型分别承诺 | 上游服务端 issue · toolkit#120 |
| M2（覆盖索引/范例库/分类法） | 🧊 冻结·研究轨 | — | M0 完成 + OQ-1/2/3 确认 + 执行服务端具备调用级遥测 |
| M3（遥测挖掘/L1 卡/recovery/autofix） | 🧊 冻结·研究轨 | — | M2 解冻 + 生产流量 ≥1 万次调用/月 |
| M4（toolbelt/lockfile/contract/协议版本化） | 🧊 冻结·研究轨 | 例外：金融工具带清单可作 skills 仓纯文档产物先行 | M1–M3 全绿；本迭代不冻结协议版本、不启动 Sunset |
| 贯穿 | — | 每批合入跑基准回归（M0 前对照口径标注"仪器未验证"） | 私有基准仓 |

## 九、安全与滥用考量

- **Live probe 薅数据**：sampled 层限 1 行、限流（每 key 每工具每小时 N 次）、计象征费用；采样响应不含可独立成品的数据密度。
- **范例库 ToS 合规**：逐供应商确认缓存条款；范例带 TTL 与来源标注；受限工具关闭范例（元数据 exemplar_policy 开关）。
- **autofix 责任归属**：计费主体仍是调用方，meta.autofixed 完整披露前后值；置信度阈值保守（建议 ≥0.95 才自动应用）；key 级永久禁用开关。
- **遥测挖掘隐私边界**：参数值脱敏白名单（symbol/日期/枚举可展示；自由文本、账户类参数不进卡片）；发布管线加人工审核位。
- **覆盖索引投毒**：聚合按 key 去重加权（单 key 贡献封顶），目录同步作为独立证据源对冲。
- **恢复程序失效循环**：fix_success_rate 随遥测滚动更新，低于阈值自动摘除。

## 十、开放问题与被否决的备选方案

### 10.1 开放问题（评审前置项）

| # | 问题 | 阻塞 | owner |
|---|---|---|---|
| OQ-1 | 执行服务端执行记录是否持久化参数原文与响应体/摘要；字段名与保留策略 | M2 覆盖索引 | buxibuxi |
| OQ-2 | 适配器层空/错分类现状；5.3 分类法最低成本落点 | M2 | buxibuxi |
| OQ-3 | 覆盖索引物理选型与事件流基础设施现状 | M2 | buxibuxi |
| OQ-4 | 计费引擎干跑可行性与大小相关计费占比 | M1 报价 | buxibuxi |
| OQ-5 | coverage_keys/range_keys 元数据治理分工 | M2 | ax2 + 数据运营 |
| OQ-6 | L1 卡 intent 短语离线生成与人工抽检流程、多语言策略 | M3 | ax2 |
| OQ-7 | toolbelt 权限模型（个人/团队/公开）与配额计费归属 | M4 | 产品 |
| OQ-8 | 第三方依赖普查（按 UA/key 特征识别直连 REST 集成） | 阶段 B | 平台运营 |

### 10.2 被否决的备选方案

- **ALT-1：/v2 路径大版本**——否决。生态尚小、SDK 分散，路径版本造成双端点长期并存与文档分裂；参数级 opt-in + 修订号 + Sunset 以更低生态成本达成同等演进。若未来出现无法 additive 的信封级重构，再启用路径版本。
- **ALT-2：GraphQL 统一查询层**——否决。字段选择由 respond_with/JSONPath 以更低迁移成本满足；GraphQL 对确定性场景的 codegen 与缓存生态更复杂。
- **ALT-3：仅客户端裁剪**——已作为过渡实施（优化方案 P0），否决为终局：省不了下行带宽，沉淀不了服务端知识资产，且每个客户端各裁一遍。
- **ALT-4：Skill 卡放文档站 / SKILL.md**——否决为主路径。运行时 agent 不读文档站；SKILL.md 分发无法保证遥测级新鲜度。保留 SKILL.md 作为 L1 卡离线导出格式。
- **ALT-5：一步强切新默认**——否决。半年存量依赖 + 未普查长尾集成，爆炸半径不可估；三阶段 Sunset 的约 6 个月双形态维护成本可接受。

---

**附录 · 关联材料**（内部设计文档与私有跟踪，链接见私有 tracker）：金融基准 Smoke 评测报告 · 集成层降本增效优化方案 · 上游服务端数据/覆盖 issue · 私有基准仓验证项 · 基准运行 run-2026-07-04T13-54-23-499Z-26cd4152（可重放核对）
