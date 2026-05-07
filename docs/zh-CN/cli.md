# QVeris CLI

QVeris 能力路由网络的官方命令行工具。直接在终端或 Agent 框架中发现、检查和调用 10,000+ 真实已验证的 API 能力。

**为什么用 CLI？** MCP 会将工具 schema 注入每轮 LLM prompt（每个工具消耗数百 token），而 CLI 作为子进程执行 — 零 prompt token、确定性输出、即时启动。

## 安装

### 一键安装（推荐）

```bash
curl -fsSL https://qveris.ai/cli/install | bash
```

脚本自动检查 Node.js 18+，全局安装 `@qverisai/cli`，并添加到 PATH。

### npm

```bash
npm install -g @qverisai/cli
```

### npx（免安装）

```bash
npx @qverisai/cli discover "weather API"
```

### 环境要求

- Node.js 18+
- 零运行时依赖（仅使用 Node.js 内置 API）

---

## 快速开始

```bash
# 1. 认证（保存到 ~/.config/qveris/config.json）
qveris login

# 2. 发现工具
qveris discover "weather forecast API"

# 3. 检查工具（使用 discover 结果的索引）
qveris inspect 1

# 4. 调用
qveris call 1 --params '{"wfo": "LWX", "x": 90, "y": 90}'
```

---

## 命令

### `qveris discover`

使用自然语言搜索 API 能力。返回工具名称、提供商、ID、描述、相关性得分、成功率、延迟和计费规则摘要（如可用）。

```bash
qveris discover <query> [flags]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--limit <n>` | 最大结果数 | 5 |
| `--json` | 输出原始 JSON | false |

**示例：**

```bash
qveris discover "stock price API"
qveris discover "translate text to French" --limit 10
qveris discover "cryptocurrency market data" --json
```

**每个工具的输出字段：**
- 工具名称和提供商
- `tool_id`（用于 inspect/call）
- 描述
- 相关性得分、成功率、延迟、计费规则摘要
- 分类和区域（如适用）
- 已验证标记（如工具有执行历史）

---

### `qveris inspect`

查看工具的完整详情。显示参数的类型、描述、枚举值、提供商信息和示例参数。

```bash
qveris inspect <tool_id|index> [flags]
```

| 参数 | 说明 |
|------|------|
| `--discovery-id <id>` | 引用特定的发现会话 |
| `--json` | 输出原始 JSON |

数字索引（如 `1`、`2`）引用上一次 `discover` 的结果。

**示例：**

```bash
# 按索引
qveris inspect 1

# 按工具 ID
qveris inspect openweathermap.weather.current.v1

# 检查多个工具
qveris inspect 1 2 3
```

**输出包含：**
- 工具名称、ID、描述
- 提供商名称和描述
- 区域、延迟、成功率、计费规则
- **参数：** 名称、类型、必填/可选、描述、允许值（枚举）
- 示例参数
- 最近执行记录（如有）

---

### `qveris call`

执行一个能力。返回结构化结果、执行时间、预结算账单和剩余积分。最终是否扣费请通过 `qveris usage` 或 `qveris ledger` 查询。

```bash
qveris call <tool_id|index> [flags]
```

| 参数 | 说明 | 默认值 |
|------|------|--------|
| `--params <json\|@file\|->` | JSON、文件路径或 stdin | `{}` |
| `--discovery-id <id>` | 发现会话 ID | 自动从 session 获取 |
| `--max-size <bytes>` | 响应大小限制（-1 = 无限制） | 4KB (TTY) / 20KB (管道) |
| `--dry-run` | 预览请求，不实际执行 | false |
| `--codegen <lang>` | 调用后生成代码片段 | — |
| `--json` | 输出原始 JSON | false |

**参数输入方式：**

```bash
# 内联 JSON
qveris call 1 --params '{"city": "London"}'

# 从文件
qveris call 1 --params @params.json

# 从 stdin
echo '{"city": "London"}' | qveris call 1 --params -
```

**Dry run（不消耗积分）：**

```bash
qveris call 1 --params '{"symbol": "AAPL"}' --dry-run
```

**代码生成：**

```bash
# 调用成功后生成 curl、Python 或 JavaScript 代码片段
qveris call 1 --params '{"symbol": "AAPL"}' --codegen curl
qveris call 1 --params '{"symbol": "AAPL"}' --codegen python
qveris call 1 --params '{"symbol": "AAPL"}' --codegen js
```

#### 响应截断

终端使用时（TTY），超过 4KB 的结果自动截断。CLI 会显示：

- 截断内容的预览
- OSS 下载链接（120 分钟有效）
- 响应的 JSON Schema，帮助理解数据结构
- 提示：`Use --max-size -1 for full output`

Agent/脚本场景（`--json` 或管道输出）默认提高到 20KB。用 `--max-size -1` 获取完整结果。

---

### `qveris login`

使用 QVeris API key 认证。如果未预设区域，会先提示选择站点区域（Global / China），然后打开对应的 API key 页面并掩码输入。

```bash
qveris login [flags]
```

| 参数 | 说明 |
|------|------|
| `--token <key>` | 直接提供 key（跳过浏览器和区域选择） |
| `--no-browser` | 不打开浏览器 |

```bash
# 交互式（选择区域 → 打开浏览器 → 掩码输入）
qveris login

# 非交互式
qveris login --token "sk-1_your-key-here"
```

交互式登录时，如果未设置 `QVERIS_REGION` 或 `--base-url`，会提示选择区域：

```
Select your region / 选择站点区域:

  1) Global  — qveris.ai  (International users)
  2) China   — qveris.cn  (中国大陆用户)

Enter 1 or 2:
```

Key 保存到 `~/.config/qveris/config.json`，权限为 `0600`（仅所有者可读写）。

### `qveris logout`

从配置中移除已存储的 API key。

### `qveris whoami`

显示当前认证状态、key 来源、所属区域，并验证 key 有效性。

### `qveris credits`

查看剩余积分余额。

### `qveris usage`

查询调用级使用审计，默认使用 `summary` 聚合模式，避免把大量流水直接输出到 Agent 上下文。
`summary` 模式会优先请求服务端 `summary=true` 聚合摘要；若旧部署暂不支持，则回退到有上限的客户端聚合。

```bash
qveris usage --mode summary --bucket hour
qveris usage --mode search --execution-id <execution_id> --json
qveris usage --mode search --min-credits 30 --max-credits 100 --json
qveris usage --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

常用过滤参数：`--execution-id`、`--search-id`、`--charge-outcome`、`--min-credits`、`--max-credits`、`--start-date`、`--end-date`。

### `qveris ledger`

查询最终 credits 账本，默认使用 `summary` 聚合模式。
`summary` 模式会优先请求服务端 `summary=true` 聚合摘要；若旧部署暂不支持，则回退到有上限的客户端聚合。

```bash
qveris ledger --mode summary --bucket day
qveris ledger --mode search --direction consume --min-credits 50 --json
qveris ledger --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

`export-file` 会把原始记录写入 `.qveris/exports/*.jsonl`，只返回文件路径和记录数，不直接打印全量记录。

---

### `qveris interactive`

启动 REPL 会话，支持链式 discover/inspect/call 工作流。会话状态保存在内存中并持久化到磁盘。

```bash
qveris interactive [flags]
```

别名：`qveris repl`

**REPL 命令：**

| 命令 | 说明 |
|------|------|
| `discover <query>` | 发现能力 |
| `inspect <index\|id>` | 查看工具详情 |
| `call <index\|id> {json}` | 执行工具 |
| `codegen <curl\|js\|python>` | 从上次调用生成代码 |
| `history` | 显示会话状态 |
| `help` | 显示命令 |
| `exit` | 退出 |

```bash
qveris> discover "crypto price API"
qveris> inspect 1
qveris> call 1 {"symbol": "BTC"}
qveris> codegen python
qveris> exit
```

---

### `qveris doctor`

自检诊断：验证 Node.js 版本、API key 配置、区域和 API 地址、API 连通性。

### `qveris config`

管理 CLI 设置。

```bash
qveris config <subcommand> [args]
```

| 子命令 | 说明 |
|--------|------|
| `set <key> <value>` | 设置配置值 |
| `get <key>` | 获取配置值 |
| `list` | 列出所有设置及来源 |
| `reset` | 重置为默认值 |
| `path` | 打印配置文件路径 |

**配置项：** `api_key`, `base_url`, `default_limit`, `default_max_size`, `color`, `output_format`

### `qveris completions`

生成 Shell 自动补全脚本。

```bash
# Bash
eval "$(qveris completions bash)"

# Zsh
eval "$(qveris completions zsh)"

# Fish
qveris completions fish | source
```

### `qveris history`

显示当前会话状态（上次查询、结果、时间）。

```bash
qveris history [--clear]
```

---

## 全局参数

所有命令通用：

| 参数 | 缩写 | 说明 |
|------|------|------|
| `--json` | `-j` | 输出原始 JSON（适合 Agent/脚本） |
| `--api-key <key>` | | 覆盖 API key |
| `--base-url <url>` | | 覆盖 API 地址 |
| `--timeout <seconds>` | | 请求超时 |
| `--no-color` | | 禁用 ANSI 颜色 |
| `--verbose` | `-v` | 显示详细输出 |
| `--version` | `-V` | 打印版本 |
| `--help` | `-h` | 显示帮助 |

支持 `--key=value` 语法和组合短参数（`-jv`）。

用 `--` 结束选项解析：`qveris discover -- --literal-query`。

---

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `QVERIS_API_KEY` | API 认证密钥 | — |
| `QVERIS_REGION` | 强制区域：`global` 或 `cn` | 从 key 自动检测 |
| `QVERIS_BASE_URL` | 覆盖 API 地址 | 从区域自动设置 |
| `QVERIS_DEFAULT_LIMIT` | 默认 discover 限制 | 5 |
| `QVERIS_DEFAULT_MAX_SIZE` | 默认响应大小限制 | 4096 |
| `XDG_CONFIG_HOME` | 配置目录基础路径 | `~/.config` |
| `NO_COLOR` | 禁用颜色（标准） | — |
| `FORCE_COLOR` | 强制颜色（即使管道） | — |

**优先级：** `--flag` > 环境变量 > 配置文件 > 默认值

---

## 区域

区域从 API key 前缀自动检测，无需额外配置。

| Key 前缀 | 区域 | API 地址 |
|----------|------|----------|
| `sk-xxx` | 全球 | `https://qveris.ai/api/v1` |
| `sk-cn-xxx` | 中国 | `https://qveris.cn/api/v1` |

**交互式登录：** 运行 `qveris login` 时，如果未设置 `QVERIS_REGION` 或 `--base-url`，会提示选择区域。仅用于首次人工登录。

**Agent / 脚本使用：** Agent 和脚本应跳过交互式提示。区域自动解析：

```bash
# 方式 1：Key 前缀自动检测（推荐）
qveris login --token "sk-cn-xxx"    # 自动检测为中国区

# 方式 2：环境变量
export QVERIS_REGION=cn
qveris login --token "sk-xxx"

# 方式 3：显式 API 地址
export QVERIS_BASE_URL=https://qveris.cn/api/v1

# 方式 4：单次命令参数
qveris discover "weather" --base-url https://qveris.cn/api/v1
```

---

## 会话管理

每次 `discover` 后，CLI 将会话状态保存到 `~/.config/qveris/.session.json`：

- 发现 ID
- 查询内容
- 区域和 API 地址
- 结果列表（tool_id、名称、提供商）

后续 `inspect` 和 `call` 自动读取会话，支持数字索引快捷方式：

```bash
qveris discover "weather API"    # 保存会话
qveris inspect 1                  # 使用会话中的索引 1
qveris call 2 --params '{...}'   # 使用索引 2 + 发现 ID
```

会话 30 分钟后过期。用 `qveris history` 查看，`qveris history --clear` 清除。

---

## Agent / LLM 集成

### CLI vs MCP

| | CLI | MCP |
|---|---|---|
| **Token 消耗** | 零 — 子进程执行 | 高 — 工具 schema 注入每轮 prompt |
| **可扩展性** | 10,000+ 真实已验证的工具，不会撑大 prompt | 每个工具增加 ~200-500 token |
| **输出** | 确定性，`--json` 可直接解析 | 因客户端而异 |
| **调试** | 终端可见，`--dry-run` | 不透明，埋在 MCP 日志里 |

### 智能默认值

CLI 自动检测 Agent vs 人类使用场景：

| 场景 | `max_response_size` | 行为 |
|------|---------------------|------|
| 终端 (TTY) | 4KB | 人类友好，自动截断 |
| 管道/脚本 | 20KB | Agent 友好 |
| `--json` 参数 | 20KB | 显式 Agent 模式 |
| `--max-size N` | N | 用户覆盖 |

### 脚本示例

```bash
# 发现 → 提取工具 ID → 调用 → 解析结果
TOOL=$(qveris discover "weather" --json | jq -r '.results[0].tool_id')
SEARCH_ID=$(qveris discover "weather" --json | jq -r '.search_id')
qveris call "$TOOL" --discovery-id "$SEARCH_ID" --params '{"city":"London"}' --json | jq '.result.data'
```

---

## 退出码

遵循 BSD `sysexits.h` 规范：

| 码 | 常量 | 含义 |
|----|------|------|
| 0 | `EX_OK` | 成功 |
| 2 | `EX_USAGE` | 参数错误 |
| 69 | `EX_UNAVAILABLE` | 服务不可用 |
| 75 | `EX_TEMPFAIL` | 超时或限流 |
| 77 | `EX_NOPERM` | 认证错误或积分不足 |
| 78 | `EX_CONFIG` | 缺少 API key |

---

## 旧命令兼容

以下别名支持向后兼容（会显示弃用警告）：

| 别名 | 映射到 |
|------|--------|
| `search` | `discover` |
| `execute` | `call` |
| `invoke` | `call` |
| `get-by-ids` | `inspect` |
| `--search-id` | `--discovery-id` |

---

## 架构

```
@qverisai/cli
├── bin/qveris.mjs           # 入口
├── src/
│   ├── main.mjs              # 命令分发 + 参数解析
│   ├── commands/              # 12 个命令处理器
│   ├── client/api.mjs         # HTTP 客户端（原生 fetch）
│   ├── client/auth.mjs        # API key 解析
│   ├── config/region.mjs      # 区域自动检测
│   ├── config/store.mjs       # 配置文件读写（0600 权限）
│   ├── session/session.mjs    # 会话持久化
│   ├── output/formatter.mjs   # 人类友好格式化
│   ├── output/codegen.mjs     # 代码片段生成
│   └── errors/handler.mjs     # 错误处理 + BSD 退出码
└── scripts/install.sh         # 一键安装脚本
```

**零运行时依赖。** 仅使用 Node.js 18+ 内置 API。没有 chalk、commander、yargs。

---

## 链接

- 官网：[qveris.ai](https://qveris.ai)（全球）/ [qveris.cn](https://qveris.cn)（中国）
- GitHub：[QVerisAI/QVerisAI](https://github.com/QVerisAI/QVerisAI)
- npm：[@qverisai/cli](https://www.npmjs.com/package/@qverisai/cli)
- REST API：[docs/zh-CN/rest-api.md](rest-api.md)
- MCP Server：[docs/zh-CN/mcp-server.md](mcp-server.md)
- 获取 API Key：[qveris.ai/account](https://qveris.ai/account?page=api-keys) / [qveris.cn/account](https://qveris.cn/account?page=api-keys)
