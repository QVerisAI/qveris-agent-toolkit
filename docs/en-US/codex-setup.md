# Codex and ChatGPT Desktop Setup

This guide configures the QVeris MCP server and skill for the ChatGPT desktop app, Codex CLI, and the Codex IDE extension. These local clients share the same Codex MCP configuration. ChatGPT on the web does not read local Codex configuration; it requires a separately hosted plugin or remote MCP integration.

## Prerequisites

- The ChatGPT desktop app, Codex CLI, or Codex IDE extension
- A QVeris API key (create one in [Dashboard / API Keys](/account?page=api-keys))
- Node.js 18.2 or later only for the local stdio fallback

## 1. Add Hosted MCP (recommended)

The ChatGPT desktop app, Codex CLI, and Codex IDE extension support Streamable HTTP MCP servers with Bearer authentication and share the same Codex MCP configuration. Add this remote server once, then use it from any of those local clients:

```toml
[mcp_servers.qveris]
url = "https://mcp.qveris.ai/mcp"
http_headers = { Authorization = "Bearer your-api-key-here" }
```

You can add the same server interactively in **Settings → MCP servers**: choose **Streamable HTTP**, enter `https://mcp.qveris.ai/mcp`, and add the `Authorization: Bearer your-api-key-here` header. Restart the client after saving. See the official [MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp) for client-specific steps.

## 2. Local stdio fallback

Use this only when Hosted MCP is unavailable in the client environment. Run the following command in a terminal, replacing `your-api-key-here` with your API key:

Run the following command in a terminal, replacing `your-api-key-here` with your API key:

```bash
codex mcp add qveris --env QVERIS_API_KEY=your-api-key-here -- npx -y @qverisai/mcp
```

QVeris automatically uses `https://qveris.ai/api/v1` for this setup. If you need to make the endpoint explicit, add it as another environment variable:

```bash
codex mcp add qveris --env QVERIS_API_KEY=your-api-key-here --env QVERIS_BASE_URL=https://qveris.ai/api/v1 -- npx -y @qverisai/mcp
```

The ChatGPT desktop app, Codex CLI, and IDE extension read this server from `~/.codex/config.toml`, so you only need to add it once. You can also add the same STDIO server from **Settings → MCP servers** in the desktop app or IDE extension.

### Manual configuration

Alternatively, add the following to `~/.codex/config.toml`:

```toml
[mcp_servers.qveris]
command = "npx"
args = ["-y", "@qverisai/mcp"]

[mcp_servers.qveris.env]
QVERIS_API_KEY = "your-api-key-here"
```

## 3. Install the QVeris skill

Install the QVeris skill for your user account:

**macOS and Linux:**

```bash
mkdir -p ~/.agents/skills/qveris
curl -sL https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md -o ~/.agents/skills/qveris/SKILL.md
```

**Windows PowerShell:**

```powershell
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.agents\skills\qveris"
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/QVerisAI/qveris-agent-toolkit/main/skills/qveris/SKILL.md" -OutFile "$env:USERPROFILE\.agents\skills\qveris\SKILL.md"
```

Codex detects skills in `~/.agents/skills`. If the skill does not appear, restart the client. See the official [skills guide](https://learn.chatgpt.com/docs/build-skills) for supported locations and invocation methods.

## Verification

1. Run `codex mcp list` and confirm that `qveris` is enabled.
2. In the ChatGPT desktop app or Codex terminal UI, enter `/mcp` and confirm that QVeris tools are connected.
3. Ask Codex to use QVeris to discover a tool. You can explicitly invoke the skill by typing `$qveris` in your prompt.

## Troubleshooting

**The local stdio server does not start:**

- Verify Node.js: `node --version`
- Run the server directly: `QVERIS_API_KEY=your-api-key-here npx -y @qverisai/mcp`
- Check that the API key is current and has no extra spaces

**The skill does not appear:**

- Confirm that the file is at `~/.agents/skills/qveris/SKILL.md`
- Restart the ChatGPT desktop app, Codex CLI, or IDE extension

**ChatGPT web does not show QVeris:**

- ChatGPT web does not read local `config.toml` files. Use a QVeris plugin when it is available in ChatGPT Work; otherwise use the desktop app, Codex CLI, or IDE extension configured above.
