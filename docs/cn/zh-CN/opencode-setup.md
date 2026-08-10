# OpenCode 配置指南

本指南介绍如何在 [OpenCode](https://opencode.ai/) 中以用户级别配置 QVeris MCP 服务器和技能。

## 前置条件

- 仅使用本地 stdio 备用方案时才需要安装 Node.js
- 已安装 OpenCode（[安装指南](https://opencode.ai/docs/)）
- QVeris API 密钥（在[控制台/API密钥](/account?page=api-keys)中创建）

## 1. 托管 MCP 配置（推荐）

OpenCode 支持远程 Streamable HTTP MCP 服务器。将以下服务加入全局 OpenCode 配置；它无需本地软件包或 Node.js 进程：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "qveris": {
        "type": "remote",
        "url": "https://mcp.qveris.cn/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer your-api-key-here"
        }
      }
    }
  }
}
```

重启 OpenCode，确认 QVeris 工具已出现。仅当客户端环境无法使用远程 HTTP 时，才使用下方本地 stdio 备用方案。

OpenCode V2 会在 `mcp.servers` 下发现具名 MCP 服务器，并自动暴露其工具，因此不需要额外的 `tools` 允许列表。

## 2. 本地 stdio 备用方案

可以用 QVeris CLI 生成并写入配置：

```bash
export QVERIS_BASE_URL="https://qveris.cn/api/v1"
qveris mcp configure --target opencode --write --include-key
qveris mcp validate --target opencode
```

也可以手动配置。QVeris CLI 目标会写入下面的 OpenCode V2 格式：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "qveris": {
        "type": "local",
        "command": ["npx", "-y", "@qverisai/mcp"],
        "environment": {
          "QVERIS_API_KEY": "your-api-key-here",
          "QVERIS_BASE_URL": "https://qveris.cn/api/v1"
        }
      }
    }
  }
}
```

创建或编辑全局 OpenCode 配置文件：

**Mac/Linux：**
```
~/.config/opencode/opencode.json
```

**Windows：**
```
%USERPROFILE%\.config\opencode\opencode.json
```

如果已有 `opencode.json` 文件，请将 `mcp.servers.qveris` 条目合并到现有的 `servers` 对象中。

## 3. 技能配置

从 GitHub 仓库下载 QVeris MCP/客户端技能：

**仓库地址：**https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/skills/qveris

**Mac/Linux：**
```bash
mkdir -p ~/.config/opencode/skill/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md -o ~/.config/opencode/skill/qveris/SKILL.md
```

**Windows（PowerShell）：**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skill\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.config\opencode\skill\qveris\SKILL.md"
```

技能目录结构应如下所示：
```
~/.config/opencode/skill/
└── qveris/
    └── SKILL.md
```

## 验证

1. 重启 OpenCode
2. 运行 `/mcp` 命令查看已连接的服务器
3. 让 OpenCode 使用 QVeris 搜索工具
4. 技能会自动发现 — Agent 可通过 `skill` 工具查看可用技能

## 使用

配置完成后，在提示词中引用 QVeris 即可：

```
请编写一个 Python 脚本，打印当前比特币价格。使用 qveris。
```

OpenCode 的 Agent 会自动发现 QVeris 技能和 MCP 服务器，找到并执行合适的 API 工具。

## 故障排查

**本地 stdio MCP 服务器未连接：**
- 验证 Node.js 是否已安装：`node --version`
- 手动测试 MCP 服务器：`npx -y @qverisai/mcp`
- 检查 API 密钥是否正确

**技能未加载：**
- 确认文件名为全大写的 `SKILL.md`
- 检查 frontmatter 中是否包含 `name` 和 `description`
- 确保技能目录名与 frontmatter 中的 name 一致

**Windows 问题：**
- 如果 `npx` 失败，请尝试使用完整路径或确保 Node.js 已添加到 PATH
