# QVeris CLI

The official command-line tool for the QVeris capability routing network. Discover, inspect, and call 10,000+ real-world, verified API capabilities directly from your terminal or agent framework.

**Why CLI?** Unlike MCP which injects tool schemas into every LLM prompt (consuming hundreds of tokens per tool), CLI runs as a subprocess — zero prompt tokens, deterministic output, instant startup.

## Installation

### One-liner (recommended)

```bash
curl -fsSL https://qveris.ai/cli/install | bash
```

The script checks Node.js 18+, installs `@qverisai/cli` globally, and adds it to your PATH.

### npm

```bash
npm install -g @qverisai/cli
```

### npx (no install)

```bash
npx @qverisai/cli discover "weather API"
```

### Requirements

- Node.js 18+
- Zero runtime dependencies (uses only Node.js built-in APIs)

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

## Commands

### `qveris discover`

Search for API capabilities using natural language. Returns tool name, provider, ID, description, relevance score, success rate, latency, and billing rule metadata when available.

```bash
qveris discover <query> [flags]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--limit <n>` | Max results to return | 5 |
| `--json` | Output raw JSON | false |

**Examples:**

```bash
qveris discover "stock price API"
qveris discover "translate text to French" --limit 10
qveris discover "cryptocurrency market data" --json
```

**Output fields per tool:**
- Tool name and provider
- `tool_id` (used for inspect/call)
- Description
- Relevance score, success rate, latency, billing rule summary
- Categories and region (if applicable)
- Verified badge (if tool has execution history)

---

### `qveris inspect`

View full details of a tool before calling it. Shows parameters with types, descriptions, enum values, provider info, and example parameters.

```bash
qveris inspect <tool_id|index> [flags]
```

| Flag | Description |
|------|-------------|
| `--discovery-id <id>` | Reference a specific discovery session |
| `--json` | Output raw JSON |

Numeric indexes (e.g., `1`, `2`) reference the last `discover` results.

**Examples:**

```bash
# By index from last discover
qveris inspect 1

# By tool ID
qveris inspect openweathermap.weather.current.v1

# Inspect multiple tools
qveris inspect 1 2 3
```

**Output includes:**
- Tool name, ID, description
- Provider name and description
- Region, latency, success rate, billing rule
- **Parameters:** name, type, required/optional, description, allowed values (enum)
- Example parameters
- Last execution record (if available)

---

### `qveris call`

Execute a capability with parameters. Returns structured result data, execution time, pre-settlement billing, and remaining credits. Final charge status is available through `qveris usage` and `qveris ledger`.

```bash
qveris call <tool_id|index> [flags]
```

| Flag | Description | Default |
|------|-------------|---------|
| `--params <json\|@file\|->` | Parameters as JSON, file path, or stdin | `{}` |
| `--discovery-id <id>` | Discovery session ID | auto from session |
| `--max-size <bytes>` | Response size limit (-1 = unlimited) | 4KB (TTY) / 20KB (pipe) |
| `--dry-run` | Preview request without executing | false |
| `--codegen <lang>` | Generate code snippet after call | — |
| `--json` | Output raw JSON | false |

**Parameter input methods:**

```bash
# Inline JSON
qveris call 1 --params '{"city": "London"}'

# From file
qveris call 1 --params @params.json

# From stdin
echo '{"city": "London"}' | qveris call 1 --params -
```

**Dry run (no credits consumed):**

```bash
qveris call 1 --params '{"symbol": "AAPL"}' --dry-run
```

**Code generation:**

```bash
# Generate curl, Python, or JavaScript snippet after a successful call
qveris call 1 --params '{"symbol": "AAPL"}' --codegen curl
qveris call 1 --params '{"symbol": "AAPL"}' --codegen python
qveris call 1 --params '{"symbol": "AAPL"}' --codegen js
```

#### Response Truncation

For terminal use (TTY), results larger than 4KB are automatically truncated. The CLI shows:

- A preview of the truncated content
- An OSS download link (valid 120 minutes) for the full result
- The response JSON schema so you understand the data structure
- A hint: `Use --max-size -1 for full output`

For agent/script use (`--json` or piped output), the default increases to 20KB. Use `--max-size -1` for unlimited.

---

### `qveris login`

Authenticate with your QVeris API key. If no region is pre-configured, prompts you to select your region (Global or China), then opens the browser to the corresponding API key page and prompts for masked input.

```bash
qveris login [flags]
```

| Flag | Description |
|------|-------------|
| `--token <key>` | Provide key directly (skip browser and region prompt) |
| `--no-browser` | Don't open browser |

```bash
# Interactive (select region → opens browser → masked input)
qveris login

# Non-interactive
qveris login --token "sk-1_your-key-here"
```

During interactive login, if `QVERIS_REGION` or `--base-url` is not set, you will be prompted:

```
Select your region / 选择站点区域:

  1) Global  — qveris.ai  (International users)
  2) China   — qveris.cn  (中国大陆用户)

Enter 1 or 2:
```

The key is saved to `~/.config/qveris/config.json` with `0600` permissions (owner-only).

### `qveris logout`

Remove stored API key from config.

```bash
qveris logout
```

### `qveris whoami`

Show current auth status, key source, resolved region, and validate against the API.

```bash
qveris whoami
```

### `qveris credits`

Check remaining credit balance.

```bash
qveris credits
```

### `qveris usage`

Query request-level usage audit without flooding Agent context. Defaults to `summary` mode and returns aggregates instead of full raw rows.
Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

```bash
qveris usage [flags]
```

| Flag | Description |
|------|-------------|
| `--mode summary\|search\|export-file` | Output mode. Default: `summary` |
| `--start-date <YYYY-MM-DD>` | Range start |
| `--end-date <YYYY-MM-DD>` | Range end |
| `--bucket hour\|day\|week` | Aggregation bucket for summary |
| `--execution-id <id>` | Precise execution lookup |
| `--search-id <id>` | Precise search lookup |
| `--charge-outcome <value>` | `charged`, `included`, `failed_not_charged`, `failed_charged_review` |
| `--min-credits <n>` | Minimum credit amount |
| `--max-credits <n>` | Maximum credit amount |
| `--limit <n>` | Search row cap, default 10, hard max 50 |

Examples:

```bash
qveris usage --mode summary --bucket hour
qveris usage --mode search --execution-id <execution_id> --json
qveris usage --mode search --min-credits 30 --max-credits 100 --json
qveris usage --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

### `qveris ledger`

Query final credit ledger entries without dumping full account history. Defaults to `summary` mode.
Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

```bash
qveris ledger [flags]
```

| Flag | Description |
|------|-------------|
| `--mode summary\|search\|export-file` | Output mode. Default: `summary` |
| `--start-date <YYYY-MM-DD>` | Range start |
| `--end-date <YYYY-MM-DD>` | Range end |
| `--bucket hour\|day\|week` | Aggregation bucket for summary |
| `--entry-type <type>` | Filter by ledger entry type |
| `--direction consume\|grant\|any` | Filter by debit/credit direction |
| `--min-credits <n>` | Minimum absolute credit amount |
| `--max-credits <n>` | Maximum absolute credit amount |
| `--limit <n>` | Search row cap, default 10, hard max 50 |

Examples:

```bash
qveris ledger --mode summary --bucket day
qveris ledger --mode search --direction consume --min-credits 50 --json
qveris ledger --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

`export-file` writes JSONL under `.qveris/exports/` and returns the path instead of printing every record.

---

### `qveris interactive`

Launch a REPL session for chained discover/inspect/call workflows. Session state (discovery ID, results) is held in memory and persisted to disk.

```bash
qveris interactive [flags]
```

Aliases: `qveris repl`

**REPL commands:**

| Command | Description |
|---------|-------------|
| `discover <query>` | Find capabilities |
| `inspect <index\|id>` | View tool details |
| `call <index\|id> {json}` | Execute with inline params |
| `codegen <curl\|js\|python>` | Generate code from last call |
| `history` | Show session state |
| `help` | Show commands |
| `exit` | Quit |

```bash
qveris> discover "crypto price API"
qveris> inspect 1
qveris> call 1 {"symbol": "BTC"}
qveris> codegen python
qveris> exit
```

---

### `qveris doctor`

Self-check diagnostics: verifies Node.js version, API key configuration, resolved region and base URL, and API connectivity.

```bash
qveris doctor
```

### `qveris config`

Manage CLI settings.

```bash
qveris config <subcommand> [args]
```

| Subcommand | Description |
|------------|-------------|
| `set <key> <value>` | Set a config value |
| `get <key>` | Get a config value |
| `list` | List all settings with sources |
| `reset` | Reset to defaults |
| `path` | Print config file location |

**Config keys:** `api_key`, `base_url`, `default_limit`, `default_max_size`, `color`, `output_format`

### `qveris completions`

Generate shell completion scripts.

```bash
# Bash
eval "$(qveris completions bash)"

# Zsh
eval "$(qveris completions zsh)"

# Fish
qveris completions fish | source
```

### `qveris history`

Show current session state (last discovery query, results, age).

```bash
qveris history [--clear]
```

---

## Global Flags

Available on every command:

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Output raw JSON (for agents/scripts) |
| `--api-key <key>` | | Override API key for this command |
| `--base-url <url>` | | Override API base URL |
| `--timeout <seconds>` | | Request timeout |
| `--no-color` | | Disable ANSI colors |
| `--verbose` | `-v` | Show detailed output |
| `--version` | `-V` | Print version |
| `--help` | `-h` | Show help |

Supports `--key=value` syntax and combined short flags (`-jv`).

Use `--` to end option parsing: `qveris discover -- --literal-query`.

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QVERIS_API_KEY` | API authentication key | — |
| `QVERIS_REGION` | Force region: `global` or `cn` | auto from key |
| `QVERIS_BASE_URL` | Override API base URL | auto from region |
| `QVERIS_DEFAULT_LIMIT` | Default discover limit | 5 |
| `QVERIS_DEFAULT_MAX_SIZE` | Default response size limit | 4096 |
| `XDG_CONFIG_HOME` | Config directory base | `~/.config` |
| `NO_COLOR` | Disable colors (standard) | — |
| `FORCE_COLOR` | Force colors even in pipes | — |

**Priority:** `--flag` > environment variable > config file > default

---

## Region

Region is auto-detected from your API key prefix. No extra configuration needed.

| Key prefix | Region | Base URL |
|------------|--------|----------|
| `sk-xxx` | Global | `https://qveris.ai/api/v1` |
| `sk-cn-xxx` | China | `https://qveris.cn/api/v1` |

**Interactive login:** When running `qveris login` without `QVERIS_REGION` or `--base-url`, you'll be prompted to choose a region. This is for first-time human users only.

**Agent / script usage:** Agents and scripts should skip the interactive prompt. Region is resolved automatically:

```bash
# Option 1: Key prefix auto-detection (recommended)
qveris login --token "sk-cn-xxx"    # auto-detects China region

# Option 2: Environment variable
export QVERIS_REGION=cn
qveris login --token "sk-xxx"

# Option 3: Explicit base URL
export QVERIS_BASE_URL=https://qveris.cn/api/v1

# Option 4: Per-command flag
qveris discover "weather" --base-url https://qveris.cn/api/v1
```

---

## Session Management

After each `discover`, the CLI saves session state to `~/.config/qveris/.session.json`:

- Discovery ID
- Query
- Region and base URL
- Result list (tool_id, name, provider)

Subsequent `inspect` and `call` commands auto-read this session, enabling numeric index shortcuts:

```bash
qveris discover "weather API"    # saves session
qveris inspect 1                  # uses index 1 from session
qveris call 2 --params '{...}'   # uses index 2 + discovery ID
```

Sessions expire after 30 minutes. Use `qveris history` to view and `qveris history --clear` to reset.

---

## Agent / LLM Integration

### Why CLI over MCP for agents?

| | CLI | MCP |
|---|---|---|
| **Token cost** | Zero — runs as subprocess | High — tool schemas in every prompt turn |
| **Scalability** | 10,000+ real-world, verified tools, no prompt bloat | Each tool adds ~200-500 tokens |
| **Output** | Deterministic, `--json` for parsing | Varies by client implementation |
| **Debugging** | Visible in terminal, `--dry-run` | Opaque, buried in MCP logs |

### Smart defaults

The CLI auto-detects agent vs human context:

| Context | `max_response_size` | Behavior |
|---------|---------------------|----------|
| Terminal (TTY) | 4KB | Human-friendly, auto-truncate |
| Piped / scripted | 20KB | Agent-friendly |
| `--json` flag | 20KB | Explicit agent mode |
| `--max-size N` | N | User override |

### Scripting example

```bash
# Discover, extract tool ID, call, parse result
TOOL=$(qveris discover "weather" --json | jq -r '.results[0].tool_id')
SEARCH_ID=$(qveris discover "weather" --json | jq -r '.search_id')
qveris call "$TOOL" --discovery-id "$SEARCH_ID" --params '{"city":"London"}' --json | jq '.result.data'
```

---

## Exit Codes

Following BSD `sysexits.h` conventions:

| Code | Constant | Meaning |
|------|----------|---------|
| 0 | `EX_OK` | Success |
| 2 | `EX_USAGE` | Bad arguments |
| 69 | `EX_UNAVAILABLE` | Service unavailable |
| 75 | `EX_TEMPFAIL` | Timeout or rate limit |
| 77 | `EX_NOPERM` | Auth error or insufficient credits |
| 78 | `EX_CONFIG` | Missing API key |

---

## Legacy Aliases

For backward compatibility, the following aliases are supported with deprecation warnings:

| Alias | Maps to |
|-------|---------|
| `search` | `discover` |
| `execute` | `call` |
| `invoke` | `call` |
| `get-by-ids` | `inspect` |
| `--search-id` | `--discovery-id` |

---

## Architecture

```
@qverisai/cli
├── bin/qveris.mjs           # Entry point
├── src/
│   ├── main.mjs              # Command dispatch + flag parsing
│   ├── commands/              # 12 command handlers
│   ├── client/api.mjs         # HTTP client (native fetch)
│   ├── client/auth.mjs        # API key resolution
│   ├── config/region.mjs      # Region auto-detection
│   ├── config/store.mjs       # Config file R/W (0600 perms)
│   ├── session/session.mjs    # Session persistence
│   ├── output/formatter.mjs   # Human-readable formatting
│   ├── output/codegen.mjs     # Code snippet generation
│   └── errors/handler.mjs     # Error handling + BSD exit codes
└── scripts/install.sh         # One-liner installer
```

**Zero runtime dependencies.** Node.js 18+ built-in APIs only. No chalk, no commander, no yargs.

---

## Links

- Website: [qveris.ai](https://qveris.ai) (Global) / [qveris.cn](https://qveris.cn) (China)
- GitHub: [QVerisAI/qveris-agent-toolkit](https://github.com/QVerisAI/qveris-agent-toolkit)
- npm: [@qverisai/cli](https://www.npmjs.com/package/@qverisai/cli)
- REST API: [docs/en-US/rest-api.md](rest-api.md)
- MCP Server: [docs/en-US/mcp-server.md](mcp-server.md)
- Get API Key: [qveris.ai/account](https://qveris.ai/account?page=api-keys) / [qveris.cn/account](https://qveris.cn/account?page=api-keys)
