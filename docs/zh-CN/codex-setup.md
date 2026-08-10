# Codex 与 ChatGPT 桌面端配置指南

本指南介绍如何为 ChatGPT 桌面端、Codex CLI 和 Codex IDE 扩展配置 QVeris MCP 服务器与技能。这些本地客户端共享同一份 Codex MCP 配置。ChatGPT 网页版不会读取本地 Codex 配置；网页版需要单独提供托管插件或远程 MCP 集成。

## 前置条件

- 已安装 ChatGPT 桌面端、Codex CLI 或 Codex IDE 扩展
- QVeris API 密钥（在[控制台/API 密钥](/account?page=api-keys)中创建）
- 仅使用本地 stdio 备用方案时才需要 Node.js 18.2 或更高版本

## 1. 添加托管 MCP（推荐）

ChatGPT 桌面端、Codex CLI 和 Codex IDE 扩展支持带 Bearer 认证的 Streamable HTTP MCP 服务器，并共享同一份 Codex MCP 配置。添加一次远程服务后，即可在任一上述本地客户端中使用：

```toml
[mcp_servers.qveris]
url = "https://mcp.qveris.ai/mcp"
http_headers = { Authorization = "Bearer your-api-key-here" }
```

也可以在 **“设置 → MCP 服务器”** 中交互式添加同一服务：选择 **Streamable HTTP**，填写 `https://mcp.qveris.ai/mcp`，并添加 `Authorization: Bearer your-api-key-here` 请求头。保存后重启客户端。各客户端的具体步骤请参考官方 [MCP 配置文档](https://learn.chatgpt.com/docs/extend/mcp)。

## 2. 本地 stdio 备用方案

仅当客户端环境无法使用托管 MCP 时，才使用该方案。在终端运行以下命令，并将 `your-api-key-here` 替换为你的 API 密钥：

```bash
codex mcp add qveris --env QVERIS_API_KEY=your-api-key-here -- npx -y @qverisai/mcp
```

此配置会自动使用 `https://qveris.ai/api/v1`。如果需要显式指定端点，可以再传入一个环境变量：

```bash
codex mcp add qveris --env QVERIS_API_KEY=your-api-key-here --env QVERIS_BASE_URL=https://qveris.ai/api/v1 -- npx -y @qverisai/mcp
```

ChatGPT 桌面端、Codex CLI 和 IDE 扩展都会从 `~/.codex/config.toml` 读取该服务器，因此只需添加一次。也可以在桌面端或 IDE 扩展的 **Settings → MCP servers** 中添加同一个 STDIO 服务器。

### 手动配置

也可以在 `~/.codex/config.toml` 中添加：

```toml
[mcp_servers.qveris]
command = "npx"
args = ["-y", "@qverisai/mcp"]

[mcp_servers.qveris.env]
QVERIS_API_KEY = "your-api-key-here"
```

## 3. 安装 QVeris 技能

为当前用户安装 QVeris 技能：

**macOS 和 Linux：**

```bash
mkdir -p ~/.agents/skills/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md -o ~/.agents/skills/qveris/SKILL.md
```

**Windows PowerShell：**

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.agents\skills\qveris\SKILL.md"
```

Codex 会自动发现 `~/.agents/skills` 中的技能。如果技能没有出现，请重启客户端。支持的目录和调用方式请参考官方[技能文档](https://learn.chatgpt.com/docs/build-skills)。

## 验证

1. 运行 `codex mcp list`，确认 `qveris` 已启用。
2. 在 ChatGPT 桌面端或 Codex 终端界面中输入 `/mcp`，确认 QVeris 工具已连接。
3. 让 Codex 使用 QVeris 发现工具。也可以在提示词中输入 `$qveris` 显式调用该技能。

## 故障排查

**本地 stdio 服务器无法启动：**

- 检查 Node.js：`node --version`
- 直接运行服务器：`QVERIS_API_KEY=your-api-key-here npx -y @qverisai/mcp`
- 检查 API 密钥是否有效，且首尾没有多余空格

**技能没有出现：**

- 确认文件位于 `~/.agents/skills/qveris/SKILL.md`
- 重启 ChatGPT 桌面端、Codex CLI 或 IDE 扩展

**ChatGPT 网页版没有显示 QVeris：**

- ChatGPT 网页版不会读取本地 `config.toml`。当 ChatGPT Work 中可用 QVeris 插件时使用该插件；否则使用上文配置过的桌面端、Codex CLI 或 IDE 扩展。
