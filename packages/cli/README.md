# QVeris CLI

Discover, inspect, and call 10,000+ API capabilities from your terminal.

```
$ qveris discover "weather forecast API"
Found 5 capabilities matching your query
1. weather_gov.gridpoints.forecast.retrieve.v1
2. weather_gov.gridpoints.forecast.retrieve.v3
3. openweathermap.weather.current.v1
...

$ qveris inspect 1
latency: ~180ms  ·  success rate: 99.8%  ·  cost: 3 credits

$ qveris call 1 --params '{"wfo":"LWX","x":90,"y":90}'
✓ success
{
  "forecast": "Sunny, high near 75..."
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

# 3. Inspect a tool
qveris inspect 1

# 4. Call it
qveris call 1 --params '{"city": "London"}'
```

## Commands

### Core

| Command | Description |
|---------|-------------|
| `qveris discover <query>` | Find capabilities by natural language |
| `qveris inspect <id\|index>` | View tool stats (latency, success rate, cost) |
| `qveris call <id\|index>` | Execute a capability |

### Account

| Command | Description |
|---------|-------------|
| `qveris login` | Authenticate with API key |
| `qveris logout` | Remove stored key |
| `qveris whoami` | Show current auth status |
| `qveris credits` | Check credit balance |

### Utilities

| Command | Description |
|---------|-------------|
| `qveris interactive` | Launch REPL mode |
| `qveris doctor` | Self-check diagnostics |
| `qveris config list` | View all settings |
| `qveris completions <shell>` | Generate shell completions (bash/zsh/fish) |

## Usage

### Discover

```bash
qveris discover "stock price API"
qveris discover "translate text" --limit 10
```

### Inspect

```bash
# By index (from last discover)
qveris inspect 1

# By tool ID
qveris inspect alphavantage.quote.execute.v1

# Verbose mode (shows parameters, examples)
qveris inspect 1 --verbose
```

### Call

```bash
# Inline params
qveris call 1 --params '{"symbol": "AAPL"}'

# From file
qveris call 1 --params @params.json

# From stdin
echo '{"symbol": "AAPL"}' | qveris call 1 --params -

# Dry run (validate without executing)
qveris call 1 --params '{"symbol": "AAPL"}' --dry-run

# Generate code snippet after call
qveris call 1 --params '{"symbol": "AAPL"}' --codegen curl
qveris call 1 --params '{"symbol": "AAPL"}' --codegen python
qveris call 1 --params '{"symbol": "AAPL"}' --codegen js
```

### Interactive Mode

```bash
$ qveris interactive

qveris> discover "weather API"
Found 3 capabilities matching your query
1. openweathermap.weather.current.v1
...

qveris> inspect 1
latency: ~200ms  ·  success rate: 99.5%  ·  cost: 2 credits

qveris> call 1 {"city": "London"}
✓ success
{ "temp": 18.5, ... }

qveris> codegen curl
curl -sS -X POST "https://qveris.ai/api/v1/tools/execute?tool_id=..." ...

qveris> exit
```

## Configuration

### API Key

```bash
# Option 1: Login (saves to config file)
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
| `--json` | `-j` | Output raw JSON (for piping) |
| `--verbose` | `-v` | Show detailed output |
| `--api-key <key>` | | Override API key |
| `--timeout <seconds>` | | Request timeout |
| `--no-color` | | Disable colors |
| `--version` | `-V` | Print version |
| `--help` | `-h` | Show help |

## JSON Output

All commands support `--json` for machine-readable output:

```bash
# Pipe to jq
qveris discover "weather" --json | jq '.results[0].tool_id'

# Use in scripts
TOOL_ID=$(qveris discover "weather" --json | jq -r '.results[0].tool_id')
qveris call "$TOOL_ID" --params '{"city":"London"}' --json
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

QVeris CLI uses only Node.js built-in APIs. No `chalk`, no `commander`, no `yargs`. Installs instantly.

## Links

- Website: https://qveris.ai
- API Docs: https://qveris.ai/docs
- Get API Key: https://qveris.ai/account?page=api-keys
- GitHub: https://github.com/QVerisAI/QVerisAI

## License

MIT
