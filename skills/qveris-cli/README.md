# QVeris CLI Skill

## Why CLI Skill When MCP Skill Already Exists?

The `qveris-cli` Skill complements the existing `qveris` MCP Skill, offering distinct advantages for certain scenarios:

### 1. Process Isolation & Stability

CLI runs as a **separate process**. If a tool call fails or encounters corrupt data, the fault is confined to the CLI process without affecting Claude Code's main session.

### 2. Zero Token Cost

Unlike MCP which injects tool schemas into every LLM prompt (consuming 200-500 tokens per tool), CLI runs as a subprocess — zero prompt tokens, deterministic output.

| | CLI | MCP |
|---|---|---|
| Token cost | Zero | High (schemas per turn) |
| Scalability | 10,000+ tools, no bloat | Each tool adds tokens |
| Output | Deterministic `--json` | Varies by client |
| Debugging | Visible, `--dry-run` | Opaque in MCP logs |

### 3. No MCP Dependency

- Works in environments **without MCP server setup**
- Useful for quick prototyping, debugging, or environments where MCP isn't available
- Simplifies CI/CD pipelines — just install the CLI binary

### 4. Scriptable & Automatable

CLI commands can be:
- Embedded in shell scripts
- Chained with other Unix tools (`|`, `grep`, `jq`)
- Scheduled via cron or integrated into build systems

### 5. Transparent Debugging

- See exact command being executed
- Easily replay commands for troubleshooting
- `--dry-run` validates params without consuming credits

---

## Installation

### One-liner (recommended)
```bash
curl -fsSL https://qveris.ai/cli/install | bash
```

### npm
```bash
npm install -g @qverisai/cli
```

### npx (no install)
```bash
npx @qverisai/cli discover "weather API"
```

**Requirements:** Node.js 18+

---

## Quick Start

```bash
# 1. Authenticate (saves key to ~/.config/qveris/config.json)
qveris login

# 2. Discover tools
qveris discover "weather forecast API"

# 3. Inspect a tool (use index from discover results)
qveris inspect 1

# 4. Call it
qveris call 1 --params '{"wfo": "LWX", "x": 90, "y": 90}'
```

---

## Region Configuration

Region is auto-detected from API key prefix:

| Key prefix | Region | Base URL |
|---|---|---|
| `sk-xxx` | Global | `https://qveris.ai/api/v1` |
| `sk-cn-xxx` | China | `https://qveris.cn/api/v1` |

For non-interactive/agent usage:
```bash
# Key prefix auto-detection (recommended)
qveris login --token "sk-cn-xxx"

# Or via environment
export QVERIS_REGION=cn
```

---

## Complete Workflow Example

```bash
# Discover weather tools
qveris discover "weather forecast API" --json --limit 5

# Inspect first result
qveris inspect 1 --json

# Validate params without consuming credits
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --dry-run --json

# Execute the call
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --json

# Generate production code snippet
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --codegen curl
qveris call 1 --params '{"wfo": "BOU", "x": 50, "y": 30}' --codegen python
```

**Always use `--json`** for structured output in scripts.

---

## When to Use Which

| Scenario | Recommended Skill |
|---|---|
| Claude Code session with MCP configured | `qveris` (MCP) |
| Quick one-off query without MCP setup | `qveris-cli` |
| CI/CD automation, shell scripts | `qveris-cli` |
| Need to generate production REST API code | Either — CLI has `--codegen` |
| Debugging tool calls, validating params | `qveris-cli` with `--dry-run` |
| Non-interactive environments (containers, headless) | `qveris-cli` |

---

## Troubleshooting

### Authentication Error (Exit Code 77)
```bash
# Check auth status
qveris whoami

# Re-login
qveris login
```

### Missing API Key (Exit Code 78)
```bash
# Check config location
qveris config path

# Set key directly
qveris login --token "sk-xxx"
```

### Service Unavailable (Exit Code 69)
```bash
# Run diagnostics
qveris doctor

# Check region/base URL
qveris whoami
```

### Session Expired
Sessions expire after 30 minutes. Re-run `discover` to refresh:
```bash
qveris history          # View session state
qveris history --clear  # Reset session
```

---

## Exit Codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 2 | Bad arguments |
| 69 | Service unavailable |
| 75 | Timeout or rate limit |
| 77 | Auth error or insufficient credits |
| 78 | Missing API key |

---

## Sources

- [The Advantages of Command Line Interfaces Over SDKs and DLLs](https://labs.appligent.com/appligent-labs/the-advantages-of-command-line-interfaces-over-sdks-and-dlls)
- [Why Developers Love API and CLI Tools](https://serverspace.io/about/blog/why-developers-love-api-and-cli-tools/)
- [The Return of the CLI](https://nordicapis.com/the-return-of-the-cli-clis-being-used-by-api-related-companies/)
- [CLI vs API: What's the Difference?](https://dev.to/jamaicahomes/cli-vs-api-whats-the-difference-39a)

---

## Official Documentation

- [CLI Reference](https://qveris.ai/docs/cli)
- [REST API](https://qveris.ai/docs/rest-api)
- [MCP Server](https://qveris.ai/docs/mcp-server)
- [Get API Key](https://qveris.ai/account?page=api-keys)