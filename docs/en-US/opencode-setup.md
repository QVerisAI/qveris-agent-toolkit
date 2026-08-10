# Configuration Guide for OpenCode

This guide explains how to configure the QVeris MCP server and skills in [OpenCode](https://opencode.ai/) at the user level.

## Prerequisites

- Node.js installed only for the local stdio fallback
- OpenCode installed ([installation guide](https://opencode.ai/docs/))
- QVeris API key (create one in [Dashboard / API Keys](/account?page=api-keys))

## 1. Hosted MCP Configuration (recommended)

OpenCode supports remote Streamable HTTP MCP servers. Add the following server to the global OpenCode configuration; it avoids a local package and Node.js process:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "qveris": {
      "type": "remote",
      "url": "https://mcp.qveris.ai/mcp",
      "oauth": false,
      "headers": {
        "Authorization": "Bearer your-api-key-here"
      },
      "enabled": true
    }
  }
}
```

Restart OpenCode and confirm the QVeris tools appear. Use the local stdio fallback below only if remote HTTP is unavailable in the client environment.

This is the direct `mcp.qveris` configuration produced by the QVeris CLI. If your installed OpenCode uses the V2 `mcp.servers` format, use this compatible alternative rather than mixing the two shapes:

```json
{
  "mcp": {
    "servers": {
      "qveris": {
        "type": "remote",
        "url": "https://mcp.qveris.ai/mcp",
        "oauth": false,
        "headers": {
          "Authorization": "Bearer your-api-key-here"
        }
      }
    }
  }
}
```

## 2. Local stdio fallback

You can generate and write the config with QVeris CLI:

```bash
qveris mcp configure --target opencode --write --include-key
qveris mcp validate --target opencode
```

Or configure it manually. The QVeris CLI target writes the direct-`mcp` format below:

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
  },
  "tools": {
    "qveris*": true
  }
}
```

For OpenCode V2, retain the `mcp.servers` object used above and use this local server entry:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "servers": {
      "qveris": {
        "type": "local",
        "command": ["npx", "-y", "@qverisai/mcp"],
        "environment": {
          "QVERIS_API_KEY": "your-api-key-here"
        }
      }
    }
  }
}
```

Create or edit the global OpenCode config file:

**Mac/Linux:**
```
~/.config/opencode/opencode.json
```

**Windows:**
```
%USERPROFILE%\.config\opencode\opencode.json
```

If you already have an `opencode.json` file, merge either the V2 `mcp.servers.qveris` entry or the direct `mcp.qveris` and `tools["qveris*"]` sections into your existing config. Do not nest one form inside the other.

## 3. Skills Configuration

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

**Local stdio MCP Server Not Connecting:**
- Verify Node.js is installed: `node --version`
- Test the MCP server manually: `npx -y @qverisai/mcp`
- Check your API key is correct

**Skills Not Loading:**
- Verify `SKILL.md` is spelled in all caps
- Check that frontmatter includes `name` and `description`
- Ensure the skill directory name matches the name in frontmatter

**Windows Issues:**
- If `npx` fails, try using the full path or ensure Node.js is in your PATH
