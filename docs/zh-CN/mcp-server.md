# QVeris MCP 服务器文档

## 简介

`@qverisai/mcp` 是面向 Cursor、Claude Desktop 及其他编程智能体等 MCP 兼容客户端的官方 QVeris MCP 服务器。

它通过少量 MCP 工具为智能体提供 QVeris 访问能力：

- `discover` — 用自然语言发现能力
- `inspect` — 获取工具详情（参数、成功率、示例）
- `call` — 执行工具并传入参数
- `usage_history` — 上下文安全的调用审计摘要 / 精确查询 / 文件导出
- `credits_ledger` — 上下文安全的最终积分账本摘要 / 精确查询 / 文件导出

换言之，MCP 服务器是本仓库其他文档所描述的 QVeris 核心协议的智能体侧传输层。

---

## MCP 与 REST API 对比

**适合使用 MCP 服务器的场景：**

- 将 QVeris 集成到 Cursor、Claude Desktop、OpenCode 或其他 MCP 客户端
- 希望智能体在对话中直接调用 QVeris 工具
- 希望客户端自动管理工具调用

**适合使用 REST API 的场景：**

- 编写应用代码或后端服务
- 需要对请求和响应进行直接的 HTTP 控制
- 构建 SDK 封装或生产环境集成

两种方式均映射到同一套 QVeris 协议：

| 协议操作 | MCP 工具 | REST API |
|---------|---------|---------|
| **发现** | `discover` | `POST /search` |
| **检查** | `inspect` | `POST /tools/by-ids` |
| **调用** | `call` | `POST /tools/execute` |
| **调用审计** | `usage_history` | `GET /auth/usage/history/v2` |
| **积分账本** | `credits_ledger` | `GET /auth/credits/ledger` |

> **注意：** 旧工具名称（`search_tools`、`get_tools_by_ids`、`execute_tool`）仍作为弃用别名支持。

---

## 环境要求

- Node.js `18+`
- 有效的 `QVERIS_API_KEY`
- MCP 兼容客户端

---

## 快速开始

### 通过 `npx` 安装

```bash
npx -y @qverisai/mcp
```

MCP 服务器从以下环境变量读取配置：

```bash
QVERIS_API_KEY=your-api-key          # 必填
QVERIS_REGION=cn                      # 可选：强制区域（global | cn）
QVERIS_BASE_URL=https://...          # 可选：覆盖 API 地址
```

区域从 API 密钥前缀自动检测（`sk-cn-xxx` → 中国区，`sk-xxx` → 全球）。仅在需要覆盖时设置 `QVERIS_REGION`。

### 使用 QVeris CLI 配置

可以用 CLI 生成客户端配置，无需手写 JSON。默认会打印带有 `YOUR_QVERIS_API_KEY` 占位符的安全配置；占位符输出会故意无法通过 API key 校验，直到你替换占位符或使用 `--include-key`。

```bash
# 打印安全的 Cursor 配置
qveris mcp configure --target cursor

# 使用 qveris login 或 QVERIS_API_KEY 中的 API key 写入可直接使用的配置
qveris mcp configure --target cursor --write --include-key
qveris mcp configure --target claude-desktop --write --include-key
qveris mcp configure --target opencode --write --include-key
qveris mcp configure --target openclaw --write --include-key

# Claude Code 使用 shell 命令，而不是 JSON 配置文件
qveris mcp configure --target claude-code
```

重启客户端前可以先校验配置：

```bash
qveris mcp validate --target cursor
```

对 stdio 客户端，可添加 `--probe` 启动配置中的 MCP server，并通过 `tools/list` 确认 `discover`、`inspect`、`call` 可见：

```bash
qveris mcp validate --target cursor --probe
```

### Claude Desktop 配置示例

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### Cursor 配置示例

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 中国区配置示例

中国大陆用户可添加 `QVERIS_REGION` 或使用 `sk-cn-` 前缀的密钥：

```json
{
  "mcpServers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "sk-cn-your-api-key-here",
        "QVERIS_REGION": "cn"
      }
    }
  }
}
```

各环境的详细配置指南，请参考：

- [智能体安装指南](../../agent/SETUP.md)
- [Claude Code 配置](claude-code-setup.md)
- [OpenCode 配置](opencode-setup.md)
- [IDE / CLI 配置](ide-cli-setup.md)

---

## Hosted MCP

Hosted MCP 已列入规划，但当前接入路径不依赖托管端点。在正式发布托管端点前，请使用上文的 stdio server：`npx -y @qverisai/mcp`。

托管 MCP 端点可用后，接入流程会是：

1. 创建或选择一个 QVeris API key。
2. 从 QVeris 控制台或文档复制 hosted MCP URL。
3. 按 MCP 客户端的远程 MCP 配置流程添加该 hosted URL。
4. 运行 `qveris mcp validate --target <client>` 或使用客户端内置工具列表，确认 `discover`、`inspect`、`call` 可见。

---

## 可用 MCP 工具

### 1. `discover`

使用自然语言发现能力。

这是**发现（Discover）**操作，**免费**使用。

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| `query` | string | 是 | 用自然语言描述所需能力 |
| `limit` | number | 否 | 最大返回数量（`1-100`，默认 `20`） |
| `session_id` | string | 否 | 用于追踪的会话标识符 |

示例：

```json
{
  "query": "天气预报 API",
  "limit": 10
}
```

典型响应字段：

- `search_id`
- `total`
- `results[]`
- `results[].tool_id`
- `results[].params`
- `results[].examples`
- `results[].stats`

---

### 2. `inspect`

在复用或调用之前，检查一个或多个已知 `tool_id` 的详情。

这是**检查（Inspect）**操作。

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| `tool_ids` | array | 是 | 要查询的工具 ID 数组 |
| `search_id` | string | 否 | 返回该工具的发现操作的搜索 ID |
| `session_id` | string | 否 | 用于追踪的会话标识符 |

示例：

```json
{
  "tool_ids": ["openweathermap.weather.execute.v1"],
  "search_id": "YOUR_SEARCH_ID"
}
```

以下情况建议使用 `inspect`：

- 多个候选能力看起来类似
- 调用前想重新确认参数
- 想检查成功率或延迟数据
- 复用上一轮对话中发现的工具

响应结构与 `/search` 一致，包含所请求工具的参数、示例和统计数据。

---

### 3. `call`

调用已发现的 QVeris 能力。

调用响应可能包含紧凑的 `billing` 预结算账单。最终是否扣费请通过 `usage_history` 或 `credits_ledger` 查询。

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| `tool_id` | string | 是 | 来自发现结果的工具 ID |
| `search_id` | string | 是 | 发现该工具的搜索 ID |
| `params_to_tool` | object | 是 | 传递给工具的参数字典 |
| `session_id` | string | 否 | 用于追踪的会话标识符 |
| `max_response_size` | number | 否 | 最大响应字节数（默认 `20480`） |

示例：

```json
{
  "tool_id": "openweathermap.weather.execute.v1",
  "search_id": "YOUR_SEARCH_ID",
  "params_to_tool": {"city": "北京", "units": "metric"}
}
```

典型成功响应字段：

- `execution_id`
- `tool_id`
- `success`
- `result.data`
- `elapsed_time_ms` 或 `execution_time`
- `billing` / `pre_settlement_bill`（如可用）

---

### 4. `usage_history`

当用户询问某次调用是否成功、失败或扣费时使用。默认 `summary` 模式，不会把全量历史塞进上下文。

常用参数：

- `mode`: `summary`、`search` 或 `export_file`
- `execution_id` / `search_id`
- `charge_outcome`: `charged`、`included`、`failed_not_charged`、`failed_charged_review`
- `min_credits` / `max_credits`
- `start_date` / `end_date`

`summary` 模式会优先请求服务端 `summary=true` 聚合摘要；若旧部署暂不支持，则回退到有上限的客户端聚合。

示例：

```json
{ "mode": "search", "execution_id": "EXECUTION_ID" }
```

### 5. `credits_ledger`

当用户询问余额为何变化时使用。默认 `summary` 模式。

常用参数：

- `mode`: `summary`、`search` 或 `export_file`
- `direction`: `consume`、`grant` 或 `any`
- `entry_type`
- `min_credits` / `max_credits`
- `start_date` / `end_date`

`summary` 模式会优先请求服务端 `summary=true` 聚合摘要；若旧部署暂不支持，则回退到有上限的客户端聚合。

示例：

```json
{ "mode": "search", "direction": "consume", "min_credits": 50 }
```

大量记录应使用 `mode: "export_file"`，MCP 服务器会写入 `.qveris/exports/*.jsonl` 并返回文件路径，而不是直接输出全量记录。

对于超大的工具调用输出，QVeris 可能返回：

- `truncated_content`
- `full_content_file_url`
- `message`

---

## 推荐使用模式

对于大多数智能体任务，建议使用以下流程：

1. `discover` — 发现相关能力
2. `inspect` — 在需要时检查最佳候选
3. `call` — 调用所选能力

实践中：

- 任务简单且最佳候选明确时，可直接从发现跳到调用
- 任务风险较高或参数不清晰时，在调用前插入检查步骤
- 复用上一轮找到的 `tool_id` 时，建议先重新检查再复用

---

## 会话管理

在单次用户会话中提供一致的 `session_id` 有助于：

- 保持用户会话连续性
- 随时间推移优化工具选择
- 更连贯的分析和追踪

若省略 `session_id`，MCP 服务器可能会在进程存活期间自动生成一个。

---

## 故障排查

### MCP 服务器未出现在客户端

- 确认已安装 Node.js：`node --version`
- 确认客户端 MCP 配置为有效 JSON
- 确认 `QVERIS_API_KEY` 设置正确
- 修改配置后重启 MCP 客户端

### 工具可见但调用失败

- 验证 API 密钥是否有效
- 验证所选 `tool_id` 来自此前的发现结果
- 重新运行 `inspect` 检查工具后再调用
- 检查 `params_to_tool` 是否为有效对象

### Windows 特定问题

如果在某些客户端中直接执行 `npx` 失败，用 `cmd /c` 包裹：

```json
{
  "command": "cmd",
  "args": ["/c", "npx", "-y", "@qverisai/mcp"]
}
```

---

## 相关文档

- [快速开始](getting-started.md)
- [REST API 文档](rest-api.md)
- [智能体安装指南](../../agent/SETUP.md)
- [IDE / CLI 配置指南](ide-cli-setup.md)
