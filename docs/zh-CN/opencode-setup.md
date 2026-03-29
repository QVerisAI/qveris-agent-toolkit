# OpenCode 配置指南

本指南介绍如何在 [OpenCode](https://opencode.ai/) 中以用户级别配置 QVeris MCP 服务器和技能。

## 前置条件

- 已安装 Node.js
- 已安装 OpenCode（[安装指南](https://opencode.ai/docs/)）
- QVeris API 密钥（从 [https://qveris.ai](https://qveris.ai) 获取）

## 1. MCP 服务器配置

创建或编辑全局 OpenCode 配置文件：

**Mac/Linux：**
```
~/.config/opencode/opencode.json
```

**Windows：**
```
%USERPROFILE%\.config\opencode\opencode.json
```

添加以下内容（将 `your-api-key-here` 替换为你的实际 API 密钥）：

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "qveris": {
      "type": "local",
      "command": ["npx", "-y", "@qverisai/mcp"],
      "environment": {
        "QVERIS_API_KEY": "your-api-key-here"
      },
      "enabled": true
    }
  }
}
```

如果已有 `opencode.json` 文件，请将 `mcp.qveris` 部分合并到现有配置中。

## 2. 技能配置

从 GitHub 仓库下载 QVeris MCP/客户端技能：

**仓库地址：** https://github.com/QVerisAI/QVerisAI/tree/main/skills/qveris

**Mac/Linux：**
```bash
mkdir -p ~/.config/opencode/skill/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md -o ~/.config/opencode/skill/qveris/SKILL.md
```

**Windows（PowerShell）：**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skill\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.config\opencode\skill\qveris\SKILL.md"
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
Write a python script that prints the current bitcoin price. use qveris
```

OpenCode 的 Agent 会自动发现 QVeris 技能和 MCP 服务器，找到并执行合适的 API 工具。

## 故障排查

**MCP 服务器未连接：**
- 验证 Node.js 是否已安装：`node --version`
- 手动测试 MCP 服务器：`npx -y @qverisai/mcp`
- 检查 API 密钥是否正确

**技能未加载：**
- 确认文件名为全大写的 `SKILL.md`
- 检查 frontmatter 中是否包含 `name` 和 `description`
- 确保技能目录名与 frontmatter 中的 name 一致

**Windows 问题：**
- 如果 `npx` 失败，请尝试使用完整路径或确保 Node.js 已添加到 PATH
