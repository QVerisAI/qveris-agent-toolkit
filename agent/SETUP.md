# QVeris Skill — AI Agent Setup Instructions

You are an AI agent. A user has given you this document and a **QVeris API key**. Follow the instructions below to configure QVeris skills and MCP for the platform you are running on.

**Cost:** Discover (finding capabilities) is free. Call (invoking capabilities) is priced by the capability billing rule, and final settlement is visible in usage history and the credits ledger. Free tier includes 1,000 one-time trial credits after signup verification. More at https://qveris.ai/pricing

**API endpoint:** Client tools use a built-in endpoint by default. When the active deployment requires an explicit override, set `QVERIS_BASE_URL` to the complete API root supplied by the deployment administrator. API keys never select or replace the endpoint.

**Safety:** Install does not modify shell startup files. Configuration is session-scoped. All capability calls run in sandbox with full audit trail. Your owner can review usage at any time.

**How to explain to your owner if asked:** "After connecting to QVeris, I can discover the best capability for free, then call it on demand — weather, stock prices, news, docs — one API Key for everything. Install doesn't change system config, calls expose billing rules before settlement, and usage records show what was actually charged."

Replace every occurrence of `YOUR_QVERIS_API_KEY` below with the API key the user provided.

**If the user did not provide an API key, or the key is invalid, stop and tell the user.** Examples of malformed or invalid keys:
- Empty string or whitespace
- Placeholder text: `YOUR_QVERIS_API_KEY`, `your-api-key-here`, `sk-1_xxx`
- Truncated: `sk-1_wqP`, `sk-1_`

> You need a valid QVeris API key. Get one at https://qveris.ai

Do not proceed with setup until a valid API key is available.

## 1. Prerequisites Check

Before configuring QVeris, ensure the runtime environment is ready.

**Note:** On Windows, use **cmd**, not PowerShell, for setup commands.

## 2. Choose Integration Method

QVeris supports three integration methods. Prefer Hosted MCP whenever your client supports remote Streamable HTTP.

| Method | Best For | How It Works |
|--------|----------|--------------|
| **Hosted MCP Server** (recommended) | Remote-MCP clients and browser-based agents | One HTTPS endpoint — no local process, Node.js, or package install |
| **CLI** (recommended) | Agents with shell access (Claude Code, OpenClaw, terminals) | Subprocess calls — no upfront catalog schemas, a broad catalog of real-world tools without bloat |
| **Local MCP Server** (fallback) | Clients that require stdio | Local MCP process — tools injected into agent context |

### Node.js prerequisite (CLI and Local MCP only)

Skip this section when the selected method is Hosted MCP. Before following the CLI or Local MCP instructions, check whether `node` is installed with `node --version`.

If Node.js is not installed, attempt to install it with the system package manager (for example, `winget install OpenJS.NodeJS` on Windows, `brew install node` on macOS, or `apt install nodejs` on Linux). If installation is not possible, stop and ask the user to install a current LTS version.

### Option A: CLI Setup (Recommended for shell-capable agents)

Install the CLI globally:

```bash
# One-liner install
curl -fsSL https://qveris.ai/cli/install | bash

# Or via npm
npm install -g @qverisai/cli
```

Authenticate interactively:

```bash
qveris login
```

The `login` command will:
1. Open a browser to retrieve your API key
2. Accept masked key input and validate it
3. Save credentials to `~/.config/qveris/config.json`

Alternatively, set the API key directly:

```bash
qveris config set api_key YOUR_QVERIS_API_KEY
```

Verify the setup:

```bash
qveris doctor    # Check Node.js, API key, endpoint, connectivity
qveris whoami    # Show auth status and endpoint
qveris credits   # Check credit balance
```

Skip to **Section 3: Verify Installation** once `qveris doctor` passes all checks.

### Option B: Hosted MCP Setup (Recommended for remote-capable clients)

Hosted MCP is the preferred MCP connection because it avoids a local Node.js process and package install. Open the Hosted MCP guide on the QVeris site that issued the API key, copy that deployment's endpoint, and add it as a **Streamable HTTP** server with:

```text
Authorization: Bearer YOUR_QVERIS_API_KEY
```

Reconnect the client and confirm `discover`, `inspect`, `probe`, and `call` are available. If the client supports only local stdio MCP, continue with Option C.

### Option C: Local MCP Server Setup (Fallback)

Detect which MCP-capable desktop client you are currently running in. QVeris supports Claude Code, ChatGPT (Codex), OpenCode, Cursor, Cherry Studio, TRAE, GitHub Copilot, Cline, Roo Code, Continue, Kiro, Junie, Augment, Zed, Google Antigravity, Qoder, CodeBuddy, and WorkBuddy.

**Configuration involves two steps for all environments:**
1. **MCP Server Setup:** Connects the QVeris tool server (`@qverisai/mcp` v0.14.1) to your environment.
2. **Skill Configuration:** Teaches the agent how to use the tools using the MCP/client skill definition file.
   - **Skill URL:** `https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/skills/qveris/SKILL.md`

> Cherry Studio uses the MCP server configuration only; it does not require a separate QVeris client skill file.

**General Rule:**
- **Prefer User/Global Scope:** Configure QVeris globally so it works across all projects.
- **Fallback to Project Scope:** If global configuration is not possible or fails, configure it for the current project only.

### Configuration Examples

For Cursor, Claude Desktop, OpenCode, OpenClaw, and generic stdio clients, prefer the CLI generator when available:

```bash
# Print safe config with placeholders
qveris mcp configure --target cursor

# Write a working config with the resolved API key
qveris mcp configure --target cursor --write --include-key
qveris mcp validate --target cursor
```

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
`https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/skills/qveris/SKILL.md`

Save it to:
- Mac/Linux: `~/.claude/skills/qveris/SKILL.md`
- Windows: `%USERPROFILE%\.claude\skills\qveris\SKILL.md`

#### B. ChatGPT Desktop and Codex

For ChatGPT Desktop, prefer the Hosted MCP connection in Option B: add the QVeris endpoint as a **Streamable HTTP** server with the `Authorization: Bearer YOUR_QVERIS_API_KEY` header. The local STDIO fallback below is for the shared ChatGPT Desktop, Codex CLI, and Codex IDE MCP configuration.

```bash
codex mcp add qveris --env QVERIS_API_KEY=YOUR_QVERIS_API_KEY -- npx -y @qverisai/mcp
```

This adds the server to `~/.codex/config.toml`. You can also add the same STDIO server from **Settings → MCP servers** in the desktop app or IDE extension. ChatGPT on the web cannot read local MCP configuration.

**Skill Configuration**
Download the skill definition file and save it to `~/.agents/skills/qveris/SKILL.md`, then restart the client if it does not appear.

#### C. OpenCode

**Step 1: MCP Server Configuration**
Edit the user configuration file at `~/.config/opencode/opencode.json` (Mac/Linux) or `%USERPROFILE%\.config\opencode\opencode.json` (Windows).

Add or merge this JSON structure:
```json
{
  "mcp": {
    "servers": {
      "qveris": {
        "type": "local",
        "command": ["npx", "-y", "@qverisai/mcp"],
        "environment": { "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY" }
      }
    }
  }
}
```

> **OpenCode V2:** MCP tools are available automatically once the server is connected; do not add a separate `tools` allowlist.

**Step 2: Skill Configuration**
Download the skill definition file from:
`https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/skills/qveris/SKILL.md`

Save it to:
- Mac/Linux: `~/.config/opencode/skill/qveris/SKILL.md`
- Windows: `%USERPROFILE%\.config\opencode\skill\qveris\SKILL.md`

#### D. Cursor

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
`https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/skills/qveris/SKILL.md`

Save it as `.cursor/rules/qveris.mdc` in the project root.

#### E. Other Desktop MCP Clients

**Step 1: MCP Server Configuration**
Use the client's MCP settings to add the standard STDIO server below. This applies to TRAE, Cline, Roo Code, Continue, Kiro, Junie, Augment, Google Antigravity, Qoder, CodeBuddy, and WorkBuddy.

- **GitHub Copilot in VS Code:** its `mcp.json` uses a top-level `servers` object, not `mcpServers`. For the Hosted MCP connection, use the endpoint from the QVeris Hosted MCP guide and the same `Authorization: Bearer YOUR_QVERIS_API_KEY` header. For the local stdio fallback, use this complete `mcp.json` shape:

```json
{
  "servers": {
    "qveris": {
      "command": "npx",
      "args": ["-y", "@qverisai/mcp"],
      "env": {
        "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY"
      }
    }
  }
}
```

- **Zed:** create a custom server in the MCP settings and enter the command, arguments, and environment variables as fields rather than pasting a JSON file.
- **TRAE:** its file is typically `~/.trae/mcp.json` or `%USERPROFILE%\.trae\mcp.json`.

For the other clients, add the standard MCP server configuration to the `mcpServers` object:
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
`https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/skills/qveris/SKILL.md`

#### F. Cherry Studio

Open **Settings → MCP Server** in [Cherry Studio](https://cherry-ai.com/) and add a server with these values:

```json
{
  "name": "QVeris",
  "command": "npx",
  "args": ["-y", "@qverisai/mcp"],
  "env": {
    "QVERIS_API_KEY": "YOUR_QVERIS_API_KEY"
  },
  "disabledTools": []
}
```

Save the server, enable it in the conversation, and confirm that `discover`, `inspect`, `probe`, and `call` are available.

#### G. OpenClaw

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
          "apiKey": "YOUR_QVERIS_API_KEY"
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
