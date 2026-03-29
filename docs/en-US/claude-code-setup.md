# Configuration Guide for Claude Code

This guide explains how to configure QVeris MCP server and skills in Claude Code at the user level.

## Prerequisites

- Node.js installed (for running MCP servers)
- Claude Code installed
- QVeris API key (get one from [https://qveris.ai](https://qveris.ai))

## 1. MCP Server Configuration

Run the following command (replace `your-api-key-here` with your actual API key):

**Mac:**
```bash
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=your-api-key-here -- npx -y @qverisai/mcp
```

**Windows (Command Prompt):**
```cmd
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=your-api-key-here -- cmd /c npx -y @qverisai/mcp
```

**Managing MCP Servers:**
```bash
claude mcp list          # List all configured servers
claude mcp get qveris    # Get details for a specific server
claude mcp remove qveris # Remove a server
```

## 2. Skills Configuration

Download the QVeris MCP/client skill from the GitHub repository:

**Repository:** https://github.com/QVerisAI/QVerisAI/tree/main/skills/qveris

**Mac:**
```bash
mkdir -p ~/.claude/skills/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md -o ~/.claude/skills/qveris/SKILL.md
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/QVerisAI/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.claude\skills\qveris\SKILL.md"
```

Your skills directory should look like:
```
~/.claude/skills/
└── qveris/
    └── SKILL.md
```

## Verification

1. Restart Claude Code
2. Run `/mcp` command to see connected servers
3. Run `claude mcp list` to verify configuration

## Usage

Reference QVeris skills in your prompts with `@.claude/skills/qveris/` (Mac/Linux) or `@.claude\skills\qveris\` (Windows):

```
Write a python script that prints the current bitcoin price using @.claude/skills/qveris/
```

## Troubleshooting

**MCP Server Not Connecting:**
- Verify Node.js is installed: `node --version`
- Test the MCP server manually: `npx -y @qverisai/mcp`
- Check your API key is correct

**Windows Issues:**
- Ensure you're using `cmd /c` wrapper for stdio servers with `npx`
- Check that Node.js is in your PATH
