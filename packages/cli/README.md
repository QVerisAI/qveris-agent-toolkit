# QVeris CLI

Discover, inspect, and call 10,000+ API capabilities from your terminal.

New users can run the guided first-call wizard:

```bash
qveris init
```

```
$ qveris discover "weather forecast API"
Found 5 capabilities matching your query

1. icons
   weather_gov.icons.retrieve.v3.ad0b4d80
   Returns a forecast icon. Icon services in API are deprecated.
   relevance: 99%  ·  success: 100.0%  ·  latency: ~325ms  ·  billing: Charged 5.75 credits per call

2. Weather Information Retrieve
   amap_webservice.weather.weatherinfo.retrieve.v3
   Query current (base) or future (all) weather information for a specified city using adcode.
   relevance: 96%  ·  success: 83.0%  ·  latency: ~467ms  ·  billing: Charged 5.75 credits per call

$ qveris inspect 1
icons
weather_gov.icons.retrieve.v3.ad0b4d80
Returns a forecast icon. Icon services in API are deprecated.

  Provider:   weather.gov
  Region:     global
  Latency:    ~325ms
  Success:    100.0%
  Billing:    Charged 5.75 credits per call

  Parameters:
    set  string  required
      .
    timeOfDay  string  required  The time of day for which to retrieve  data (e.g., "morning", "afternoon")

    first  string  required  The first record to retrieve (index or ID)

    size  string  optional
      Font size
    fontsize  integer  optional
      Font size

  Example:
    {"set":"land","first":"sct","timeOfDay":"day"}

$ qveris call 1 --params '{"set":"land","first":"sct","timeOfDay":"day"}'
✓ success  ·  311ms  ·  5.75 credits pre-settlement  ·  (1078.15 remaining)
tool: amap_webservice.weather.weatherinfo.retrieve.v3  ·  id: d79cd15b-2f36-4ce1-bb3c-6ea28b5ecfa2

Billing:
  Total estimated pre-settlement charge: 5.75 credits
  Pre-settlement: 5.75 credits
Final charge status: qveris usage --mode search --execution-id d79cd15b-2f36-4ce1-bb3c-6ea28b5ecfa2

{
  "status": "1",
  "count": "1",
  "info": "OK",
  "infocode": "10000",
  "lives": [
    {
      "province": "北京",
      "city": "东城区",
      "adcode": "110101",
      "weather": "多云",
      "temperature": "31",
      "winddirection": "西南",
      "windpower": "≤3",
      "humidity": "50",
      "reporttime": "2026-05-13 13:33:58",
      "temperature_float": "31.0",
      "humidity_float": "50.0"
    }
  ]
}
```

## Install

**One-liner (recommended):**

```bash
# Linux / macOS
curl -fsSL https://qveris.ai/cli/install | bash

# Windows (PowerShell)
irm https://qveris.ai/cli/install.ps1 | iex
```

**Or via npm:**

```sh
npm install -g @qverisai/cli
```

**Or run without installing:**

```bash
npx @qverisai/cli discover "stock price API"
```

Requires Node.js 18+.

## Quick Start

```bash
# Guided path: auth → discover → inspect → call → usage/ledger guidance
qveris init

# Manual path
# 1. Authenticate
qveris login

# 2. Discover capabilities
qveris discover "weather forecast"

# 3. Inspect a tool (by index from discover results)
qveris inspect 1

# 4. Call it
qveris call 1 --params '{"set":"land","first":"sct","timeOfDay":"day"}'
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `qveris init` | Guided first-call wizard: auth, discover, inspect, call, and usage/ledger reconciliation guidance. |
| `qveris discover <query>` | Find capabilities by natural language. Shows tool ID, description, relevance, success rate, latency, billing rule, provider, tags, and region when available. |
| `qveris inspect <id\|index>` | View full tool details: parameters (type, required, description, enum values), example, provider info, execution history. |
| `qveris call <id\|index>` | Execute a capability. Shows result data, execution time, pre-settlement billing, and remaining credits. |

### Account

| Command | Description |
|---------|-------------|
| `qveris login` | Authenticate with API key (interactive region selection, opens browser, or `--token` for direct input) |
| `qveris logout` | Remove stored key |
| `qveris whoami` | Show current auth status, key source, and region |
| `qveris credits` | Check credit balance |
| `qveris usage` | Context-safe usage audit summary/search/export |
| `qveris ledger` | Context-safe credits ledger summary/search/export |

### Utilities

| Command | Description |
|---------|-------------|
| `qveris interactive` | Launch REPL mode (discover/inspect/call/codegen in one session) |
| `qveris doctor` | Self-check: Node.js version, API key, region, connectivity |
| `qveris config <subcommand>` | Manage CLI settings (set, get, list, reset, path) |
| `qveris mcp configure` | Generate MCP client config for Cursor, Claude Desktop, OpenCode, OpenClaw, or generic stdio; generate a `claude mcp add` command for Claude Code |
| `qveris mcp validate` | Validate an MCP config file, with optional live stdio tool probing |
| `qveris completions <shell>` | Generate shell completions (bash/zsh/fish) |

## Usage

### Init

Run the guided first-call wizard:

```bash
qveris init
qveris init --query "weather forecast API"
qveris init --dry-run
qveris init --resume --params '{"city": "London"}'
qveris init --json
```

`init` discovers a capability, inspects the selected result, calls it with sample parameters when available, and ends with exact `usage` / `ledger` commands so you can reconcile final billing. Use `--resume` after recoverable parameter or provider failures to reuse the last discovery session.

### Discover

Search for capabilities using natural language. Each result shows the tool name, provider, tool ID, description, and quality metrics to help you choose.

```bash
qveris discover "stock price API"
qveris discover "translate text" --limit 10
```

### Inspect

View full details of a tool before calling it. Shows parameters with types, required/optional, descriptions, allowed values (enum), and example parameters.

```bash
# By index (from last discover)
qveris inspect 1

# By tool ID
qveris inspect alphavantage.quote.execute.v1

# Inspect multiple tools
qveris inspect 1 2 3
```

### Call

Execute a tool. Results are automatically truncated for terminal display (4KB). Large results get an OSS download link. Billing shown here is pre-settlement; use `qveris usage` or `qveris ledger` for final charge status.

```bash
# Inline params
qveris call 1 --params '{"symbol": "AAPL"}'

# From file
qveris call 1 --params @params.json

# From stdin
echo '{"symbol": "AAPL"}' | qveris call 1 --params -

# Dry run (validate without executing, no credits consumed)
qveris call 1 --params '{"symbol": "AAPL"}' --dry-run

# Full result (no truncation)
qveris call 1 --params '{"symbol": "AAPL"}' --max-size -1

# Generate code snippet after call
qveris call 1 --params '{"symbol": "AAPL"}' --codegen curl
qveris call 1 --params '{"symbol": "AAPL"}' --codegen python
qveris call 1 --params '{"symbol": "AAPL"}' --codegen js
```

#### Response Truncation

For terminal use, results larger than 4KB are automatically truncated. The CLI shows:
- A preview of the truncated content
- A download link (valid 120 minutes) for the full result
- The response schema so you know the data structure

```
✓ success  ·  1200ms  ·  5 credits pre-settlement

Response truncated (32KB → 4KB preview)

Full content (valid 120 min):
  https://qveris-tool-results-cache-bj.oss-cn-beijing...
  Download: curl -o result.json '<url>' (Linux/macOS)
  Download: Invoke-WebRequest -Uri '<url>' -OutFile result.json (Windows PowerShell)

Schema:
  query: string
  total_results: number
  articles: array of
    pmid: string
    title: string

Preview:
  {"query": "evolution", "total_results": 890994, ...
```

For agent/script use (`--json` or piped output), the default increases to 20KB (matching the MCP server). Use `--max-size -1` for unlimited.

### MCP Configuration

Generate MCP client config without hand-editing JSON. Print mode is the default and uses `YOUR_QVERIS_API_KEY` placeholders so the output is safe to share. Placeholder output intentionally fails API key validation until you replace it or use `--include-key`. For Claude Code, the command prints a `claude mcp add` command instead of writing a config file.

```bash
# Print safe config for Cursor
qveris mcp configure --target cursor

# Write a working Cursor config using your resolved API key
qveris mcp configure --target cursor --write --include-key

# Other supported targets
qveris mcp configure --target claude-desktop --write --include-key
qveris mcp configure --target opencode --write --include-key
qveris mcp configure --target openclaw --write --include-key
qveris mcp configure --target claude-code
qveris mcp configure --target generic --json
```

Config file locations and destinations:
- **Cursor**: `~/.cursor/mcp.json` (Linux/macOS) or `%USERPROFILE%\.cursor\mcp.json` (Windows)
- **Claude Desktop**: `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows)
- **Claude Code**: no config file is written; `qveris mcp configure --target claude-code` outputs a `claude mcp add` command

Validate an existing config:

```bash
# Static config validation
qveris mcp validate --target cursor

# Live stdio probe: starts the MCP server and confirms discover/inspect/call are visible
qveris mcp validate --target cursor --probe
```

Supported targets: `cursor`, `claude-desktop`, `claude-code`, `opencode`, `openclaw`, `generic`.

### Usage Audit

Use `qveris usage` to answer whether recent calls succeeded, failed, or charged credits. It defaults to `summary` mode to protect Agent context.
Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

```bash
# Aggregate recent usage by hour/day/week
qveris usage --mode summary --bucket hour

# Check one execution precisely
qveris usage --mode search --execution-id <execution_id> --json

# Find high-cost or suspicious records
qveris usage --mode search --min-credits 30 --max-credits 100 --json
qveris usage --mode search --charge-outcome failed_charged_review --json

# Export raw matching rows to a local JSONL file instead of stdout
qveris usage --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

### Credits Ledger

Use `qveris ledger` to explain final credit balance movements. It also defaults to `summary` mode.
Summary mode requests service-side `summary=true` aggregates when available and falls back to bounded client-side aggregation for older deployments.

```bash
qveris ledger --mode summary --bucket day
qveris ledger --mode search --direction consume --min-credits 50 --json
qveris ledger --mode search --entry-type consume_tool_execute --json
qveris ledger --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

`summary` and `search` never print full history. Large record sets are written to `.qveris/exports/*.jsonl` with `--mode export-file`.

### Interactive Mode

```bash
$ qveris interactive

qveris> discover "weather API"
Found 3 capabilities matching your query
1. openweathermap.weather.current.v1  by OpenWeather
   ...

qveris> inspect 1
openweathermap.weather.current.v1
  Parameters:
    city  string  required
    ...

qveris> call 1 '{"city": "London"}'
✓ success  ·  200ms  ·  2 credits
{ "temp": 18.5, ... }

qveris> codegen curl
curl -sS -X POST "https://qveris.ai/api/v1/tools/execute?tool_id=..." ...

qveris> exit
```

## Configuration

### API Key

```bash
# Option 1: Login (saves to the qveris config file)
qveris login

# Option 2: Environment variable
# Linux / macOS
export QVERIS_API_KEY="sk-1_..."

# Windows (PowerShell)
$env:QVERIS_API_KEY="sk-1_..."

# Windows (CMD)
set QVERIS_API_KEY=sk-1_...

# Option 3: Per-command flag
qveris discover "weather" --api-key "sk-1_..."
```

**Resolution order:** `--api-key` flag > `QVERIS_API_KEY` env > config file

### Region

The API region is auto-detected from your key prefix:

| Key prefix | Region | Base URL |
|------------|--------|----------|
| `sk-xxx` | Global | `https://qveris.ai/api/v1` |
| `sk-cn-xxx` | China | `https://qveris.cn/api/v1` |

No extra configuration needed. `qveris login` prompts for region selection interactively on first use.

**Agent / script usage:** Use `--token` with a region-prefixed key, or set environment variables:

```bash
# Key prefix auto-detection (recommended)
qveris login --token "sk-cn-xxx"

# Or environment variable
# Linux / macOS
export QVERIS_REGION=cn

# Windows (PowerShell)
$env:QVERIS_REGION="cn"

# Windows (CMD)
set QVERIS_REGION=cn

# Or custom base URL
# Linux / macOS
export QVERIS_BASE_URL=https://custom.endpoint/api/v1

# Windows (PowerShell)
$env:QVERIS_BASE_URL="https://custom.endpoint/api/v1"

# Windows (CMD)
set QVERIS_BASE_URL=https://custom.endpoint/api/v1

# Or per-command
qveris discover "weather" --base-url https://qveris.cn/api/v1
```

### Config File

Located at:
- **All platforms**: `$XDG_CONFIG_HOME/qveris/config.json` when `XDG_CONFIG_HOME` is set
- **Default**: `~/.config/qveris/config.json` (for example, `C:\Users\<user>\.config\qveris\config.json` on Windows)

```bash
qveris config list          # View all settings with sources
qveris config set key value # Set a value
qveris config get key       # Get a value
qveris config path          # Print config file location
qveris config reset         # Reset to defaults
```

### Shell Completions

```bash
# Bash
eval "$(qveris completions bash)"

# Zsh
eval "$(qveris completions zsh)"

# Fish
qveris completions fish | source
```

## Global Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--json` | `-j` | Output raw JSON (for piping/agent use) |
| `--api-key <key>` | | Override API key |
| `--timeout <seconds>` | | Request timeout |
| `--max-size <bytes>` | | Response size limit (-1 = unlimited) |
| `--target <target>` | | MCP target |
| `--output <path>` | | MCP config output path |
| `--write` | | Write MCP config to disk |
| `--include-key` | | Include resolved API key instead of a placeholder |
| `--probe` | | Live-probe MCP tools during validation |
| `--no-color` | | Disable colors |
| `--version` | `-V` | Print version |
| `--help` | `-h` | Show help |

## Agent / LLM Integration

When used by agents or in scripts, the CLI auto-detects non-TTY environments:

| Context | `max_response_size` | Rationale |
|---------|---------------------|-----------|
| Terminal (TTY) | 4KB | Human-friendly, auto-truncate |
| Piped / scripted | 20KB | Agent-friendly, matches MCP server |
| `--json` flag | 20KB | Explicit agent mode |
| `--max-size N` | N | User override |

```bash
# Agent workflow: discover → select → call → parse

# Linux / macOS
TOOL=$(qveris discover "weather" --json | jq -r '.results[0].tool_id')
qveris call "$TOOL" --params '{"city":"London"}' --json | jq '.result.data'

# Windows (PowerShell)
$TOOL = qveris discover "weather" --json | ConvertFrom-Json | Select-Object -ExpandProperty results | Select-Object -First 1 | Select-Object -ExpandProperty tool_id
qveris call $TOOL --params '{"city":"London"}' --json | ConvertFrom-Json | Select-Object -ExpandProperty result | Select-Object -ExpandProperty data

 # Windows (CMD, interactive) - requires jq for Windows
for /f "tokens=*" %i in ('qveris discover "weather" --json ^| jq -r ".results[0].tool_id"') do set TOOL=%i
qveris call %TOOL% --params "{\"city\":\"London\"}" --json | jq ".result.data"

# Windows (.bat/.cmd script) - use %%i instead of %i
for /f "tokens=*" %%i in ('qveris discover "weather" --json ^| jq -r ".results[0].tool_id"') do set TOOL=%%i
qveris call %TOOL% --params "{\"city\":\"London\"}" --json | jq ".result.data"
```

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 2 | Usage error (bad arguments) |
| 69 | Service unavailable |
| 75 | Temporary failure (timeout, rate limit) |
| 77 | Auth error (invalid key, insufficient credits) |
| 78 | Config error (missing key) |

## Zero Dependencies

QVeris CLI uses only Node.js built-in APIs. No `chalk`, no `commander`, no `yargs`. Installs instantly via `npx`.

## Links

- Website: https://qveris.ai (global) / https://qveris.cn (China)
- API Docs: https://qveris.ai/docs
- Get API Key: https://qveris.ai/account?page=api-keys (global) / https://qveris.cn/account?page=api-keys (China)
- GitHub: https://github.com/QVerisAI/qveris-agent-toolkit

## License

MIT
