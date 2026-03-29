# Claude Code 配置指南

本指南介绍如何在 Claude Code 中以用户级别配置 QVeris MCP 服务器和技能。

## 前置条件

- 已安装 Node.js（用于运行 MCP 服务器）
- 已安装 Claude Code
- QVeris API 密钥（从 [https://qveris.ai](https://qveris.ai) 获取）

## 1. MCP 服务器配置

运行以下命令（将 `your-api-key-here` 替换为你的实际 API 密钥）：

**Mac：**
```bash
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=your-api-key-here -- npx -y @qverisai/mcp
```

**Windows（命令提示符）：**
```cmd
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=your-api-key-here -- cmd /c npx -y @qverisai/mcp
```

**管理 MCP 服务器：**
```bash
claude mcp list          # 列出所有已配置的服务器
claude mcp get qveris    # 查看指定服务器详情
claude mcp remove qveris # 移除服务器
```

## 2. 技能配置

从 GitHub 仓库下载 QVeris MCP/客户端技能：

**仓库地址：** https://github.com/QVerisAI/QVerisAI/tree/main/skills/qveris

**Mac：**
```bash
mkdir -p ~/.claude/skills/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md -o ~/.claude/skills/qveris/SKILL.md
```

**Windows（PowerShell）：**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.claude\skills\qveris\SKILL.md"
```

技能目录结构应如下所示：
```
~/.claude/skills/
└── qveris/
    └── SKILL.md
```

## 验证

1. 重启 Claude Code
2. 运行 `/mcp` 命令查看已连接的服务器
3. 运行 `claude mcp list` 验证配置

## 使用

在提示词中通过 `@.claude/skills/qveris/`（Mac/Linux）或 `@.claude\skills\qveris\`（Windows）引用 QVeris 技能：

```
Write a python script that prints the current bitcoin price using @.claude/skills/qveris/
```

## 故障排查

**MCP 服务器未连接：**
- 验证 Node.js 是否已安装：`node --version`
- 手动测试 MCP 服务器：`npx -y @qverisai/mcp`
- 检查 API 密钥是否正确

**Windows 问题：**
- 确保在 stdio 服务器中使用 `cmd /c` 包裹 `npx`
- 检查 Node.js 是否已添加到 PATH
