# QVeris CLI

Discover, inspect, and call 10,000+ API capabilities from your terminal.

```
$ qveris discover "weather forecast API"
Found 5 capabilities matching your query

1. gridpoint_forecast  by Weather.gov
   weather_gov.gridpoints.forecast.retrieve.v1
   Returns a textual forecast for a 2.5km grid area
   relevance: 95%  ·  success: 99.8%  ·  latency: ~180ms  ·  cost: 3 cr

2. current_weather  by OpenWeather
   openweathermap.weather.current.v1
   Get current weather data for any location
   relevance: 87%  ·  success: 99.5%  ·  latency: ~200ms  ·  cost: 2 cr

$ qveris inspect 1
gridpoint_forecast
Returns a textual forecast for a 2.5km grid area

  Provider:   Weather.gov
  Latency:    ~180ms
  Success:    99.8%
  Cost:       3 credits

  Parameters:
    wfo     string   required
      Forecast office ID
      values: "LWX", "OKX", "LAX", ...
    x       integer  required
      Forecast grid X coordinate
    y       integer  required
      Forecast grid Y coordinate

  Example:
    {"wfo": "LWX", "x": 90, "y": 90}

$ qveris call 1 --params '{"wfo":"LWX","x":90,"y":90}'
✓ success  ·  523ms  ·  10 credits  ·  (1368087.93 remaining)
tool: weather_gov...  ·  id: 7ebcaf9d-...

{
  "type": "Feature",
  "properties": {
    "periods": [
      { "name": "Today", "temperature": 79, "shortForecast": "Partly Sunny" },
      ...
    ]
  }
}
```

## Install

**One-liner (recommended):**

```bash
curl -fsSL https://qveris.ai/install | bash
```

**Or via npm:**

```bash
npm install -g @qverisai/cli
```

**Or run without installing:**

```bash
npx @qverisai/cli discover "stock price API"
```

Requires Node.js 18+.

## Quick Start

```bash
# 1. Authenticate
qveris login

# 2. Discover capabilities
qveris discover "weather forecast"

# 3. Inspect a tool (by index from discover results)
qveris inspect 1

# 4. Call it
qveris call 1 --params '{"wfo": "LWX", "x": 90, "y": 90}'
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `qveris discover <query>` | Find capabilities by natural language. Shows tool ID, provider, description, relevance, success rate, latency, and cost for each result. |
| `qveris inspect <id\|index>` | View full tool details: parameters (type, required, description, enum values), example, provider info, execution history. |
| `qveris call <id\|index>` | Execute a capability. Shows result data, execution time, cost, and remaining credits. |

### Account

| Command | Description |
|---------|-------------|
| `qveris login` | Authenticate with API key (opens browser or `--token` for direct input) |
| `qveris logout` | Remove stored key |
| `qveris whoami` | Show current auth status and key source |
| `qveris credits` | Check credit balance |

### Utilities

| Command | Description |
|---------|-------------|
| `qveris interactive` | Launch REPL mode (discover/inspect/call/codegen in one session) |
| `qveris doctor` | Self-check: Node.js version, API key, connectivity |
| `qveris config <subcommand>` | Manage CLI settings (set, get, list, reset, path) |
| `qveris completions <shell>` | Generate shell completions (bash/zsh/fish) |

## Usage

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

Execute a tool. Results are automatically truncated for terminal display (4KB). Large results get an OSS download link.

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
✓ success  ·  1200ms  ·  5 credits

Response truncated (32KB → 4KB preview)

Full content (valid 120 min):
  https://qveris-tool-results-cache-bj.oss-cn-beijing...
  Download: curl -o result.json '<url>'

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
# Option 1: Login (saves to ~/.config/qveris/config.json)
qveris login

# Option 2: Environment variable
export QVERIS_API_KEY="sk-1_..."

# Option 3: Per-command flag
qveris discover "weather" --api-key "sk-1_..."
```

**Resolution order:** `--api-key` flag > `QVERIS_API_KEY` env > config file

### Config File

Located at `~/.config/qveris/config.json` (respects `XDG_CONFIG_HOME`).

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
TOOL=$(qveris discover "weather" --json | jq -r '.results[0].tool_id')
qveris call "$TOOL" --params '{"city":"London"}' --json | jq '.result.data'
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

- Website: https://qveris.ai
- API Docs: https://qveris.ai/docs
- Get API Key: https://qveris.ai/account?page=api-keys
- GitHub: https://github.com/QVerisAI/QVerisAI

## License

MIT
