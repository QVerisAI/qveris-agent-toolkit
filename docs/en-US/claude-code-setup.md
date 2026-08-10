# Configuration Guide for Claude Code

This guide explains how to configure QVeris MCP server and skills in Claude Code at the user level.

## Prerequisites

- Node.js installed only for the local stdio fallback
- Claude Code installed
- QVeris API key (create one in [Dashboard / API Keys](/account?page=api-keys))

## 1. Hosted MCP Configuration (recommended)

Claude Code supports remote HTTP MCP servers. Add QVeris as a user-scoped Streamable HTTP server with Bearer authentication:

```bash
claude mcp add --transport http qveris https://mcp.qveris.ai/mcp --scope user --header "Authorization: Bearer your-api-key-here"
```

Restart Claude Code, run `/mcp`, and confirm that QVeris is connected. Use the local stdio fallback below only when remote HTTP is not available in the client environment.

## 2. Local stdio fallback

You can generate the command with QVeris CLI:

```bash
qveris mcp configure --target claude-code
```

Or run the command manually:

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

## 3. Skills Configuration

Download the QVeris MCP/client skill from the GitHub repository:

**Repository:** https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/skills/qveris

**Mac:**
```bash
mkdir -p ~/.claude/skills/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md -o ~/.claude/skills/qveris/SKILL.md
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.claude\skills\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.claude\skills\qveris\SKILL.md"
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

**Local stdio MCP Server Not Connecting:**
- Verify Node.js is installed: `node --version`
- Test the MCP server manually: `npx -y @qverisai/mcp`
- Check your API key is correct

**Windows Issues:**
- Ensure you're using `cmd /c` wrapper for stdio servers with `npx`
- Check that Node.js is in your PATH
