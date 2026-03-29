# QVeris MCP 服务器文档

## 简介

`@qverisai/mcp` 是面向 Cursor、Claude Desktop 及其他编程 Agent 等 MCP 兼容客户端的官方 QVeris MCP 服务器。

它通过三个 MCP 工具为 Agent 提供 QVeris 访问能力：

- `search_tools` = **发现（Discover）**
- `get_tools_by_ids` = **检查（Inspect）**
- `execute_tool` = **调用（Call）**

换言之，MCP 服务器是本仓库其他文档所描述的 QVeris 核心协议的 Agent 侧传输层。

---

## MCP vs REST API

**适合使用 MCP 服务器的场景：**

- 将 QVeris 集成到 Cursor、Claude Desktop、OpenCode 或其他 MCP 客户端
- 希望 Agent 在对话中直接调用 QVeris 工具
- 希望客户端自动管理工具调用

**适合使用 REST API 的场景：**

- 编写应用代码或后端服务
- 需要对请求和响应进行直接的 HTTP 控制
- 构建 SDK 封装或生产环境集成

两种方式均映射到同一套 QVeris 协议：

| 协议操作 | MCP 工具 | REST API |
|---------|---------|---------|
| **发现** | `search_tools` | `POST /search` |
| **检查** | `get_tools_by_ids` | `POST /tools/by-ids` |
| **调用** | `execute_tool` | `POST /tools/execute` |

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

MCP 服务器从以下环境变量读取 API 密钥：

```bash
QVERIS_API_KEY=your-api-key
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

各环境的详细配置指南，请参考：

- [Claude Code 配置](claude-code-setup.md)
- [OpenCode 配置](opencode-setup.md)
- [IDE / CLI 配置](ide-cli-setup.md)

---

## 可用 MCP 工具

### 1. `search_tools`

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
  "query": "weather forecast API",
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

### 2. `get_tools_by_ids`

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

以下情况建议使用 `get_tools_by_ids`：

- 多个候选能力看起来类似
- 调用前想重新确认参数
- 想检查成功率或延迟数据
- 复用上一轮对话中发现的工具

响应 schema 与 `/search` 一致，包含所请求工具的参数、示例和统计数据。

---

### 3. `execute_tool`

调用已发现的 QVeris 能力。

这是**调用（Call）**操作，每次调用消耗 **1–100 积分**，按数据和任务价值计费。

| 参数 | 类型 | 必填 | 说明 |
|-----|------|------|------|
| `tool_id` | string | 是 | 来自发现结果的工具 ID |
| `search_id` | string | 是 | 发现该工具的搜索 ID |
| `params_to_tool` | string | 是 | JSON 字符串化的工具参数 |
| `session_id` | string | 否 | 用于追踪的会话标识符 |
| `max_response_size` | number | 否 | 最大响应字节数（默认 `20480`） |

示例：

```json
{
  "tool_id": "openweathermap.weather.execute.v1",
  "search_id": "YOUR_SEARCH_ID",
  "params_to_tool": "{\"city\":\"London\",\"units\":\"metric\"}"
}
```

典型成功响应字段：

- `execution_id`
- `tool_id`
- `success`
- `result.data`
- `elapsed_time_ms` 或 `execution_time`
- `cost`

对于超大输出，QVeris 可能返回：

- `truncated_content`
- `full_content_file_url`
- `message`

---

## 推荐使用模式

对于大多数 Agent 任务，建议使用以下流程：

1. `search_tools` — 发现相关能力
2. `get_tools_by_ids` — 在需要时检查最佳候选
3. `execute_tool` — 调用所选能力

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
- 重新运行 `get_tools_by_ids` 检查工具后再调用
- 检查 `params_to_tool` 是否为有效 JSON

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
- [IDE / CLI 配置指南](ide-cli-setup.md)
