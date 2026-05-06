# QVeris Agent Guidelines

Guidelines for AI agents integrating with the QVeris capability routing network. Covers discovery query formulation, tool selection, parameter handling, error recovery, and large result handling.

This document is platform-agnostic — applicable to MCP agents (Cursor, Claude Code, OpenCode), OpenClaw agents, and any other agent framework. Reference it from your agent skill definition.

---

## Core Concept

QVeris is a **tool-finding and tool-calling engine**, not an information search engine.

- `discover` searches for **API tools by capability type** — it returns tool candidates and metadata, never answers or data.
- `call` runs the selected tool to get actual data.

**discover answers "which API tool can do X?" — it cannot answer "what is the value of Y?"**

---

## Discovery Query Formulation

### Rule 1: Describe the tool type, not the data you want

The query must describe an API capability, not a factual question or entity name.

| User request | BAD query | GOOD query | Why |
|-------------|-----------|------------|-----|
| "Nvidia latest earnings" | ~~`"Nvidia quarterly earnings data"`~~ | `"company earnings report API"` | Discover finds tools, not data |
| "Beijing weather today" | ~~`"Beijing weather today"`~~ | `"weather forecast API"` | Entity goes in params, not query |
| "Is Zhipu AI listed?" | ~~`"Zhipu AI stock listing"`~~ | Use web_search instead | Factual question, not tool need |
| "Generate a cat image" | ~~`"generate a cat picture"`~~ | `"text to image generation API"` | Describe capability, not task |
| "BTC price" | ~~`"what is BTC price"`~~ | `"cryptocurrency price API"` | Data request vs tool type |
| "Translate to French" | ~~`"translate hello to French"`~~ | `"text translation API"` | Task vs capability |

### Rule 2: Write queries in English

User requests in any language must be converted to English **capability descriptions**:

- "腾讯最新股价" → `"stock quote real-time API"` (not `"Tencent latest stock price"`)
- "文字生成图片" → `"text to image generation API"` (not `"文字生成图片"`)

### Rule 3: Retry with rephrased queries

If the first discovery yields poor results, try synonyms or different domain terms:

- First try: `"map routing directions"` → Retry: `"navigation turn-by-turn API"`
- First try: `"PDF to text"` → Retry: `"document OCR extraction API"`

---

## Domain Coverage

QVeris has strong coverage in these domains. Prefer QVeris over web search for structured data:

| Domain | Example queries |
|--------|----------------|
| **Finance** | `"stock price API"`, `"forex rate"`, `"earnings report"`, `"financial statement"` |
| **Crypto** | `"cryptocurrency price"`, `"DeFi TVL"`, `"on-chain analytics"` |
| **Economics** | `"GDP data"`, `"inflation statistics"`, `"economic indicators"` |
| **Weather/Geo** | `"weather forecast"`, `"air quality"`, `"geocoding"`, `"navigation"` |
| **News/Social** | `"news headlines"`, `"social media trending"`, `"RSS feed"` |
| **Scientific** | `"paper search API"`, `"clinical trials"`, `"PubMed"` |
| **Generation** | `"text to image"`, `"TTS"`, `"video generation"` |
| **Processing** | `"OCR"`, `"PDF extraction"`, `"web scraping"`, `"translation"` |
| **Search** | `"web search API"`, `"web content extraction"` |

### When to use QVeris vs Web Search

| Task type | Use | Reasoning |
|-----------|-----|-----------|
| Structured/quantitative data (prices, rates, time series) | **QVeris** | Returns structured JSON from professional APIs |
| Non-native capability (image gen, OCR, TTS, translation) | **QVeris** | Requires external APIs; web search cannot perform them |
| Any task that local tools cannot fulfill | **QVeris** | 10,000+ tools — it may have what you need |
| No web search tool configured | **QVeris** | `discover "web search API"` to find one, then `call` it |
| Qualitative info (opinions, tutorials, documentation) | **Web search** | Better served by browsing pages |
| Factual questions ("Who founded X?", "Is Y listed?") | **Web search** | QVeris finds tools, not answers |
| Local computation, code, text manipulation | **Neither** | No external call needed |

---

## Tool Selection Criteria

When `discover` returns multiple tools, evaluate before selecting:

| Signal | Preferred | Acceptable | Avoid |
|--------|-----------|------------|-------|
| `success_rate` | >= 90% | 70-89% | < 70% |
| `avg_execution_time_ms` | < 2000ms | 2000-5000ms | > 5000ms (unless gen task) |
| Parameter quality | Clear descriptions + samples | Basic descriptions | No descriptions |
| Output relevance | Matches region/format needed | Partial match | Wrong region/format |

Additional signals:

- **`final_score`** (relevance): Higher = better match to your query
- **`has_last_execution`**: Tool has been verified in production
- **`billing_rule`**: Preferred pricing signal when present. Legacy `cost` is only a fallback estimate.

---

## Billing Transparency and Usage Audit

QVeris separates billing into three layers:

| Layer | Field / command | Meaning |
|-------|-----------------|---------|
| Pricing rule | `billing_rule` | How the capability is priced |
| Pre-settlement bill | `billing` / `pre_settlement_bill` | What this call theoretically costs |
| Final settlement | `usage_history` / `credits_ledger` | Whether credits were actually charged and how balance changed |

Do not treat `cost` or `credits_used` as the only billing truth. They are legacy fallback fields.

### Checking Whether a Call Was Charged

Use `usage_history` for request-level audit:

```bash
qveris usage --mode search --execution-id <execution_id> --json
```

Look at `success`, `charge_outcome`, `actual_amount_credits`, and `credits_ledger_entry_id`.

Common `charge_outcome` values:

| Value | Meaning |
|-------|---------|
| `charged` | The request was charged |
| `included` | The request succeeded but settled at 0 credits |
| `failed_not_charged` | The request failed and was not charged |
| `failed_charged_review` | Failed request with a charge-like signal; review needed |

Use `credits_ledger` for final balance movement:

```bash
qveris ledger --mode search --min-credits 50 --direction consume --json
```

### Context-Safe Audit Pattern

Usage and ledger records can be large. Never dump full history into the prompt by default.

Use this order:

1. `summary` mode first for aggregate totals.
2. `search` mode with precise filters for row-level investigation.
3. `export-file` mode for large analysis; then read the local JSONL file in chunks.

Examples:

```bash
qveris usage --mode summary --bucket hour --json
qveris usage --mode search --charge-outcome failed_charged_review --json
qveris usage --mode search --min-credits 30 --max-credits 100 --json
qveris ledger --mode summary --bucket day --json
qveris ledger --mode export-file --start-date 2026-05-01 --end-date 2026-05-04
```

### Known Tools Cache

After a successful discover + call, cache the `tool_id` and working parameters in session memory. In later turns, use `inspect` to re-verify and call directly — skip the full discovery.

---

## Parameter Handling

### Before calling a tool

1. **Read all parameter descriptions** from the discovery/inspect results
2. **Fill all required parameters** — use `examples.sample_parameters` as template
3. **Validate types**: strings quoted (`"London"`), numbers unquoted (`42`), booleans (`true`/`false`)
4. **Check formats**: dates (ISO 8601: `"2026-01-15"`), identifiers (ticker symbol not company name), geo (lat/lng vs city name)
5. **Extract structured values** from the user's request — do not pass natural language as parameter values

### Common parameter mistakes

| Mistake | Example | Fix |
|---------|---------|-----|
| Number as string | `"limit": "10"` | `"limit": 10` |
| Wrong date format | `"date": "01/15/2026"` | `"date": "2026-01-15"` |
| Missing required param | Omitting `symbol` for stock API | Always check required list |
| Natural language as param | `"query": "what is AAPL price"` | `"symbol": "AAPL"` |
| Company name instead of ticker | `"symbol": "Apple"` | `"symbol": "AAPL"` |

---

## Error Recovery

Failures are almost always caused by incorrect parameters, wrong types, or selecting the wrong tool — not by platform instability. Diagnose inputs before concluding a tool is broken.

**Attempt 1 — Fix parameters**: Read the error message. Check types, formats, required fields. Fix and retry.

**Attempt 2 — Simplify**: Drop optional parameters. Try well-known standard values (e.g., `"AAPL"` for stock). Retry.

**Attempt 3 — Switch tool**: Select the next-best tool from discovery results. Call with appropriate parameters.

**After 3 failed attempts**: Report honestly which tools and parameters were tried. Fall back to web search (mark the source clearly).

**Never**:
- Give up after one failure
- Say "I don't have real-time data" without trying QVeris first
- Use training data values as live results

---

## Large Result Handling

When a tool response exceeds `max_response_size`, the API returns:

| Field | Description |
|-------|-------------|
| `truncated_content` | Preview of the first N bytes |
| `full_content_file_url` | OSS download link (valid 120 minutes) |
| `content_schema` | JSON Schema of the full data structure |
| `message` | Truncation explanation |

**Agent behavior**:

- Treat `truncated_content` as a preview — conclusions from it alone may be incomplete
- If your environment has a file retrieval mechanism, use it to fetch the full content
- If not, tell the user the result was truncated and provide the download URL
- Use `content_schema` to understand the full data structure without downloading

---

## CLI Workflow

When using the QVeris CLI (`@qverisai/cli` v0.4.0) instead of MCP, the same Discover → Inspect → Call pattern applies via shell commands.

### Basic Agent Workflow

```bash
# Discover tools (free)
qveris discover "weather forecast API" --json

# Inspect top result by index (free)
qveris inspect 1 --json

# Call with parameters. The response may include pre-settlement billing.
qveris call 1 --params '{"city": "London"}' --json

# Validate without consuming credits
qveris call 1 --params '{"city": "London"}' --dry-run --json

# Generate code snippet after successful call
qveris call 1 --params '{"city": "London"}' --codegen curl
```

### Key Flags for Agents

| Flag | Purpose |
|------|---------|
| `--json` | Structured JSON output — always use in agent/script contexts |
| `--dry-run` | Validate parameters without executing (no credits consumed) |
| `--codegen <curl\|js\|python>` | Generate API call snippets from last successful call |
| `--params <json\|@file\|->` | Pass parameters as inline JSON, from file (`@params.json`), or stdin (`-`) |
| `--limit <n>` | Limit discover results (default: 5) |
| `--max-size <bytes>` | Response size limit; `-1` for unlimited (default: 4KB TTY, 20KB non-TTY). MCP default is 20KB. |

### Audit Commands

| Command | Purpose |
|---------|---------|
| `qveris usage` | Context-safe usage audit summary/search/export |
| `qveris ledger` | Context-safe credits ledger summary/search/export |

Both commands default to `--mode summary`, return at most a small sample of records, and write large result sets to `.qveris/exports/*.jsonl` with `--mode export-file`.

### Session & Index Shortcuts

After `qveris discover`, results are stored in a session file (30-minute TTL). Use numeric indices in subsequent commands:

```bash
qveris discover "stock price API"    # Returns indexed results: 1, 2, 3...
qveris inspect 1                     # Inspect first result by index
qveris call 1 --params '...'         # Call first result by index
```

The session tracks the discovery ID, so `inspect` and `call` automatically link back to the original discovery for analytics. Use `qveris history` to view current session state.

### Diagnostics

Run `qveris doctor` to check setup: Node.js version, API key validity, region detection, and API connectivity.

---

## Self-Check (before responding)

- Is my discover query a **tool type description** or a **factual question**? → If it contains specific names, "is X listed?", or "what is Y?" — use web_search.
- Am I about to **state a live number**? → Discover and call first; training data is not live data.
- Am I about to **use web search for structured data** (prices, rates, rankings)? → QVeris returns structured JSON directly.
- Am I about to **give up because QVeris failed**? → Re-engage. Rephrase query or fix parameters.
- Did the result include `full_content_file_url`? → Treat inline payload as partial.

---

## API Quick Reference

**Base URL**:

| Region | Base URL | Key prefix |
|--------|----------|------------|
| Global | `https://qveris.ai/api/v1` | `sk-xxx` |
| China  | `https://qveris.cn/api/v1` | `sk-cn-xxx` |

Region is auto-detected from the API key prefix. Override with `QVERIS_REGION=cn` or `QVERIS_BASE_URL=...` if needed.

**Auth**: `Authorization: Bearer ${QVERIS_API_KEY}`

| Action | REST Endpoint | MCP Tool | CLI Command |
|--------|--------------|----------|-------------|
| Discover | `POST /search` | `discover` | `qveris discover <query>` |
| Inspect | `POST /tools/by-ids` | `inspect` | `qveris inspect <id\|index>` |
| Call | `POST /tools/execute?tool_id=...` | `call` | `qveris call <id\|index>` |
| Usage audit | `GET /auth/usage/history/v2` | `usage_history` | `qveris usage` |
| Credits ledger | `GET /auth/credits/ledger` | `credits_ledger` | `qveris ledger` |

**REST Body Examples:**

| Action | Body |
|--------|------|
| Discover | `{"query": "...", "limit": 10}` |
| Inspect | `{"tool_ids": ["..."], "search_id": "..."}` |
| Call | `{"search_id": "...", "parameters": {...}, "max_response_size": 20480}` |

> **MCP backward compatibility:** Old tool names `search_tools`, `get_tools_by_ids`, `execute_tool` are still supported as deprecated aliases in MCP server v0.5.0. Use the new names (`discover`, `inspect`, `call`) going forward.

Full API documentation: https://github.com/QVerisAI/QVerisAI/blob/main/docs/en-US/rest-api.md
