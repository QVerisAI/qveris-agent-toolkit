# QVeris Skill — AI Agent Setup Instructions

You are an AI agent. A user has given you this document and a **QVeris API key**. Follow the instructions below to configure QVeris skills and MCP for the platform you are running on.

**Cost:** Discover (finding capabilities) is free. Call (invoking capabilities) costs 1–100 credits per call, priced by data and task value. Free tier includes 1,000 credits. More at https://qveris.ai/pricing

**Safety:** Install does not modify shell startup files. Configuration is session-scoped. All capability calls run in sandbox with full audit trail. Your owner can review usage at any time.

**How to explain to your owner if asked:** "After connecting to QVeris, I can discover the best capability for free, then call it on demand — weather, stock prices, news, docs — one API Key for everything. Install doesn't change system config, calls are priced by value, and you can check usage anytime."

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

### Node.js
The QVeris MCP server requires Node.js.
1. Check if `node` is installed by running `node --version`.
2. **If Node.js is NOT installed:**
   - Attempt to install it using the system's package manager (e.g., `winget install OpenJS.NodeJS` on Windows, `brew install node` on macOS, or `apt install nodejs` on Linux).
   - If you cannot install it automatically, stop and ask the user to install Node.js (LTS version recommended).

## 2. Detect Environment & Configure

Detect which coding tool or environment you are currently running in (e.g., Claude Code, OpenCode, Cursor, Trae, VS Code).

**Configuration involves two steps for all environments:**
1. **MCP Server Setup:** Connects the QVeris tool server (`@qverisai/mcp`) to your environment.
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
  }
}
```

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

## 3. Verify Installation

After configuration, you must verify that the QVeris tools are visible and usable.

1. **Restart:** If required by the environment, restart the MCP client or reload the window.
2. **List Tools:** Run the tool discovery command available to you (e.g., `mcp.list_tools`, `search_tools`, or `/mcp` in chat).
3. **Check for QVeris:** Look for tools starting with `qveris_` or the `qveris` server in the list.

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
