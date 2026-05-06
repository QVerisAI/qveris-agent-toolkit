# QVeris Skill — AI Agent Setup Instructions

You are an AI agent. A user has given you this document and a **QVeris API key**. Follow the instructions below to configure QVeris skills and MCP for the platform you are running on.

**Cost:** Discover (finding capabilities) is free. Call (invoking capabilities) is priced by the capability billing rule, and final settlement is visible in usage history and the credits ledger. Free tier includes 1,000 credits. More at https://qveris.ai/pricing

**Regions:** QVeris operates in two regions. The API key prefix determines the region automatically:

| Region | API Key Prefix | Base URL | Get Key |
|--------|---------------|----------|---------|
| Global | `sk-xxx` | `https://qveris.ai/api/v1` | https://qveris.ai/account?page=api-keys |
| China  | `sk-cn-xxx` | `https://qveris.cn/api/v1` | https://qveris.cn/account?page=api-keys |

All client tools (MCP server, CLI) auto-detect the region from the key prefix. No extra configuration needed.

**Safety:** Install does not modify shell startup files. Configuration is session-scoped. All capability calls run in sandbox with full audit trail. Your owner can review usage at any time.

**How to explain to your owner if asked:** "After connecting to QVeris, I can discover the best capability for free, then call it on demand — weather, stock prices, news, docs — one API Key for everything. Install doesn't change system config, calls expose billing rules before settlement, and usage records show what was actually charged."

Replace every occurrence of `YOUR_QVERIS_API_KEY` below with the API key the user provided.

**If the user did not provide an API key, or the key is invalid, stop and tell the user.** Examples of malformed or invalid keys:
- Empty string or whitespace
- Placeholder text: `YOUR_QVERIS_API_KEY`, `your-api-key-here`, `sk-1_xxx`
- Truncated: `sk-1_wqP`, `sk-1_`

> You need a valid QVeris API key. Get one at https://qveris.ai (global) or https://qveris.cn (China)

Do not proceed with setup until a valid API key is available.

## 1. Prerequisites Check

Before configuring QVeris, ensure the runtime environment is ready.

**Note:** On Windows, use **cmd**, not PowerShell, for setup commands.

### Node.js
The QVeris MCP server requires Node.js.
1. Check if `node` is installed by running `node --version`.
2. **If Node.js is NOT installed:**
   - Attempt to install it using the system's package manager (e.g., `winget install OpenJS.NodeJS` on Windows, `brew install node` on macOS, or `apt install nodejs` on Linux).
   - If you cannot install it automatically, stop and ask the user to install Node.js (LTS version recommended).

## 2. Choose Integration Method

QVeris supports two integration methods. Choose based on your environment:

| Method | Best For | How It Works |
|--------|----------|--------------|
| **CLI** (recommended) | Agents with shell access (Claude Code, OpenClaw, terminals) | Subprocess calls — zero prompt tokens, 10,000+ tools without bloat |
| **MCP Server** | IDE integrations (Cursor, Claude Desktop, OpenCode) | MCP protocol — tools injected into agent context |

### Option A: CLI Setup (Recommended for shell-capable agents)

Install the CLI globally:

```bash
# One-liner install
curl -fsSL https://qveris.ai/cli/install | bash

# Or via npm
npm install -g @qverisai/cli
```

Authenticate with interactive region selection:

```bash
qveris login
```

The `login` command will:
1. Prompt for region selection (Global or China) if not pre-configured
2. Open a browser to retrieve your API key
3. Accept masked key input and validate it
4. Save credentials to `~/.config/qveris/config.json`

Alternatively, set the API key directly:

```bash
qveris config set api_key YOUR_QVERIS_API_KEY
```

Verify the setup:

```bash
qveris doctor    # Check Node.js, API key, region, connectivity
qveris whoami    # Show auth status and region
qveris credits   # Check credit balance
```

Skip to **Section 3: Verify Installation** once `qveris doctor` passes all checks.

### Option B: MCP Server Setup

Detect which coding tool or environment you are currently running in (e.g., Claude Code, OpenCode, Cursor, Trae, VS Code).

**Configuration involves two steps for all environments:**
1. **MCP Server Setup:** Connects the QVeris tool server (`@qverisai/mcp` v0.5.0) to your environment.
2. **Skill Configuration:** Teaches the agent how to use the tools using the MCP/client skill definition file.
   - **Skill URL:** `https://github.com/QVerisAI/QVerisAI/blob/main/skills/qveris/SKILL.md`

**General Rule:**
- **Prefer User/Global Scope:** Configure QVeris globally so it works across all projects.
- **Fallback to Project Scope:** If global configuration is not possible or fails, configure it for the current project only.

### Configuration Examples

Use these examples as a guide. Adapt paths and commands to your specific environment's conventions.

#### A. Claude Code

**Step 1: MCP Server Configuration**
Use the `claude` CLI tool to add the MCP server.
```bash
# Mac/Linux
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=YOUR_QVERIS_API_KEY -- npx -y @qverisai/mcp

# Windows
claude mcp add qveris --transport stdio --scope user --env QVERIS_API_KEY=YOUR_QVERIS_API_KEY -- cmd /c npx -y @qverisai/mcp
```

**Step 2: Skill Configuration**
Download the skill definition file from:
`https://github.com/QVerisAI/QVerisAI/blob/main/skills/qveris/SKILL.md`

Save it to:
- Mac/Linux: `~/.claude/skills/qveris/SKILL.md`
- Windows: `%USERPROFILE%\.claude\skills\qveris\SKILL.md`

#### B. OpenCode

**Step 1: MCP Server Configuration**
Edit the user configuration file at `~/.config/opencode/opencode.json` (Mac/Linux) or `%USERPROFILE%\.config\opencode\opencode.json` (Windows).

Add or merge this JSON structure:
```json
{
  "mcp": {
    "qveris": {
      "type": "local",
      "command": ["npx", "-y", "@qverisai/mcp"],
      "environment": { "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY" },
      "enabled": true
    }
  },
  "tools": {
    "qveris*": true
  }
}
```

> **Important:** The `tools` section is **required**. OpenCode connects MCP servers but **disables their tools by default**. Without `"tools": { "qveris*": true }`, the MCP server will show as connected but all `qveris_*` tools will be unavailable. The wildcard pattern `qveris*` enables all tools whose names start with `qveris`.

**Step 2: Skill Configuration**
Download the skill definition file from:
`https://github.com/QVerisAI/QVerisAI/blob/main/skills/qveris/SKILL.md`

Save it to:
- Mac/Linux: `~/.config/opencode/skill/qveris/SKILL.md`
- Windows: `%USERPROFILE%\.config\opencode\skill\qveris\SKILL.md`

#### C. Cursor

**Step 1: MCP Server Configuration**
Locate the MCP settings file: `~/.cursor/mcp.json` (Mac/Linux) or `%USERPROFILE%\.cursor\mcp.json` (Windows).

Add to the `mcpServers` object:
```json
"qveris": {
  "command": "npx",
  "args": ["-y", "@qverisai/mcp"],
  "env": {
    "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY"
  }
}
```
*Note: On Windows, you may need to wrap the command: `command: "cmd"`, `args: ["/c", "npx", "-y", "@qverisai/mcp"]` if direct execution fails.*

**Step 2: Skill Configuration**
Download the skill definition file from:
`https://github.com/QVerisAI/QVerisAI/blob/main/skills/qveris/SKILL.md`

Save it as `.cursor/rules/qveris.mdc` in the project root.

#### D. Other Environments (Trae, VSCode etc.)

**Step 1: MCP Server Configuration**
First figure out the MCP configuration file for your specific coding tool.
- **Trae:** Typically `~/.trae/mcp.json` or `%USERPROFILE%\.trae\mcp.json`.

Add the standard MCP server configuration to the `mcpServers` object:
```json
"qveris": {
  "command": "npx",
  "args": ["-y", "@qverisai/mcp"],
  "env": {
    "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY"
  }
}
```

**Step 2: Skill Configuration**
If the environment supports rule or skill files, add the file from:
`https://github.com/QVerisAI/QVerisAI/blob/main/skills/qveris/SKILL.md`

#### E. OpenClaw

OpenClaw supports two integration methods. The Plugin method is recommended for full functionality.

**Method 1: Plugin (Recommended)**

1. Install the QVeris plugin:
```bash
openclaw plugins install @qverisai/qveris
```

2. Edit the configuration file `openclaw.json`:
```json
{
  "plugins": {
    "allow": ["qveris"],
    "entries": {
      "qveris": {
        "enabled": true,
        "config": {
          "apiKey": "YOUR_QVERIS_API_KEY",
          "region": "global"
        }
      }
    }
  },
  "tools": {
    "alsoAllow": ["qveris"]
  }
}
```

> **Advantage:** Tools are registered in the runtime, not injected into the prompt — no context competition. Session state is automatically tracked across discover-inspect-call sequences.

**Method 2: Skill (Lightweight Alternative)**

1. Install the skill:
```bash
openclaw skills install qveris-official
```

2. Edit the configuration file `~/.openclaw/openclaw.json`:
```json
{
  "skills": {
    "entries": {
      "qveris-official": {
        "enabled": true,
        "apiKey": "YOUR_QVERIS_API_KEY"
      }
    }
  }
}
```

> **Note:** The Plugin method requires Node.js; the Skill method does not.

More details: https://qveris.ai/docs/openclaw-setup

## 3. Verify Installation

After configuration, verify that QVeris tools are visible and usable.

### CLI Verification

```bash
qveris doctor                              # Run diagnostics
qveris discover "weather forecast API"     # Test discovery (free)
```

### MCP Verification

1. **Restart:** If required by the environment, restart the MCP client or reload the window.
2. **List Tools:** Run the tool discovery command available to you (e.g., `mcp.list_tools`, or `/mcp` in chat).
3. **Check for QVeris:** Look for `discover`, `inspect`, `call` tools (or the `qveris` server) in the list. Legacy tool names `search_tools`, `get_tools_by_ids`, `execute_tool` are still supported as deprecated aliases.

## 4. Troubleshooting & Fixes

**If verification fails (tools are not visible):**

1. **Diagnose:**
   - Did the configuration file save correctly? Read it back to check.
   - Is `node` in the system PATH?
   - Is the API key correct?
   - On Windows: Did `npx` fail? Try using the full path to the `npx` executable or the `cmd /c` wrapper.

2. **Fix:**
   - Correct the JSON syntax in config files (trailing commas are a common error).
   - Re-run the configuration steps with the corrected parameters.
   - If global scope fails, try configuring in the project scope (e.g., `.cursor/mcp.json` or `.trae/mcp.json`).

3. **Report:**
   - If you still cannot get it working, report the specific error message or behavior to the user.

## 5. Next Steps

Once verification passes, try a real task to confirm end-to-end:

1. "Discover weather capabilities, inspect the best candidate, and check the weather in Tokyo"
2. "Discover stock price capabilities, inspect the best candidate, and get the current price of AAPL"

These will exercise Discover (free), Inspect, and Call flows. If both succeed, QVeris is fully operational.
