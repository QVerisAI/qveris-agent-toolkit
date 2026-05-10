# Configuration Guide for OpenCode

This guide explains how to configure the QVeris MCP server and skills in [OpenCode](https://opencode.ai/) at the user level.

## Prerequisites

- Node.js installed
- OpenCode installed ([installation guide](https://opencode.ai/docs/))
- QVeris API key (get one from [https://qveris.ai](https://qveris.ai))

## 1. MCP Server Configuration

Create or edit the global OpenCode config file:

**Mac/Linux:**
```
~/.config/opencode/opencode.json
```

**Windows:**
```
%USERPROFILE%\.config\opencode\opencode.json
```

Add the following content (replace `your-api-key-here` with your actual API key):

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

If you already have an `opencode.json` file, merge the `mcp.qveris` section into your existing config.

## 2. Skills Configuration

Download the QVeris MCP/client skill from the GitHub repository:

**Repository:** https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/skills/qveris

**Mac/Linux:**
```bash
mkdir -p ~/.config/opencode/skill/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md -o ~/.config/opencode/skill/qveris/SKILL.md
```

**Windows (PowerShell):**
```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.config\opencode\skill\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.config\opencode\skill\qveris\SKILL.md"
```

Your skills directory should look like:
```
~/.config/opencode/skill/
└── qveris/
    └── SKILL.md
```

## Verification

1. Restart OpenCode
2. Run `/mcp` command to see connected servers
3. Ask OpenCode to search for tools using QVeris
4. Skills are auto-discovered - the agent will see available skills via the `skill` tool

## Usage

Once configured, reference QVeris in your prompts:

```
Write a python script that prints the current bitcoin price. use qveris
```

OpenCode's agent will automatically discover the QVeris skill and MCP server to find and execute the appropriate API tools.

## Troubleshooting

**MCP Server Not Connecting:**
- Verify Node.js is installed: `node --version`
- Test the MCP server manually: `npx -y @qverisai/mcp`
- Check your API key is correct

**Skills Not Loading:**
- Verify `SKILL.md` is spelled in all caps
- Check that frontmatter includes `name` and `description`
- Ensure the skill directory name matches the name in frontmatter

**Windows Issues:**
- If `npx` fails, try using the full path or ensure Node.js is in your PATH
