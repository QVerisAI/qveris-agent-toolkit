# QVeris Plugin for OpenClaw

[![npm version](https://img.shields.io/npm/v/@qverisai/qveris?label=npm)](https://www.npmjs.com/package/@qverisai/qveris)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-%3E%3D2026.3.22-blue)](https://github.com/openclaw/openclaw)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

OpenClaw plugin that gives agents dynamic capability discovery and tool calling via the [QVeris](https://qveris.ai) API.

## What it does

Three tools are registered into the agent's context once the plugin is loaded:

| Tool | Description |
|------|-------------|
| `qveris_discover` | Search for tools by natural language query (e.g. "weather", "currency exchange") |
| `qveris_call` | Execute a discovered tool with parameters |
| `qveris_inspect` | Look up detailed schema and examples for known tool IDs |

The typical agent workflow is: `qveris_discover` → `qveris_inspect` (optional) → `qveris_call`.

## Requirements

- OpenClaw >= 2026.3.22
- A QVeris API key — sign up at [qveris.ai](https://qveris.ai) (global) or [qveris.cn](https://qveris.cn) (China)

---

## Installation

### From npm

```bash
openclaw plugins install @qverisai/qveris
```

### From local source (development)

```bash
# From the repo root
openclaw plugins install -l ./extensions/qveris
```

### Package safety checks

The published npm package is limited to runtime plugin files. Unit tests, integration tests, fixtures, helper scripts, and coverage output are intentionally excluded so normal installation does not require a security-audit override.

Before publishing, verify the package contents:

```bash
npm run build
npm pack --dry-run --json
npm run check:pack
```

Real network integration tests must live under `integration/` and are disabled by default:

```bash
QVERIS_RUN_INTEGRATION=1 npm run test:integration
```

---

## Configuration

Add the following to your `openclaw.json`:

```json5
{
  // 1. Allow the plugin and make its tools visible to the agent
  plugins: {
    allow: ["qveris"],
    entries: {
      qveris: {
        enabled: true,
        config: {
          apiKey: "qv-your-api-key-here",  // or use QVERIS_API_KEY env var
          region: "cn"                      // "global" (qveris.ai) or "cn" (qveris.cn)
        }
      }
    }
  },

  // 2. Add QVeris tools to the agent's tool allowlist
  tools: {
    alsoAllow: ["qveris"]
  }
}
```

> **Note**: `tools.alsoAllow` is required. Without it, plugin tools are not passed to the LLM even though the plugin is loaded.

### API key via environment variable

If you prefer not to store the key in the config file:

```bash
export QVERIS_API_KEY=qv-your-api-key-here
```

The plugin checks `plugins.entries.qveris.config.apiKey` first, then falls back to `QVERIS_API_KEY`.

> **Security**: if no API key is found at startup, all three tools are silently omitted — no error is thrown.

---

## Full configuration reference

All fields under `plugins.entries.qveris.config`:

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `apiKey` | `string` | — | QVeris API key. Sensitive — use env var `QVERIS_API_KEY` as alternative. |
| `region` | `"global"` \| `"cn"` | `"global"` | API region. `global` → `qveris.ai`, `cn` → `qveris.cn`. |
| `baseUrl` | `string` | *(derived from region)* | Override API base URL. Use only when pointing at a private/staging endpoint. |
| `searchTimeoutSeconds` | `number` | `5` | Timeout for `qveris_discover` calls. |
| `executeTimeoutSeconds` | `number` | `60` | Default timeout for `qveris_call`. Can be overridden per-call via the `timeout_seconds` parameter. |
| `searchLimit` | `number` | `10` | Max number of tools returned by `qveris_discover`. |
| `maxResponseSize` | `number` | `20480` | Max response body size in bytes before truncation. |
| `autoMaterializeFullContent` | `boolean` | `false` | When `true`, automatically download full-content files referenced in tool results to the agent workspace. |
| `fullContentMaxBytes` | `number` | `10485760` (10 MB) | Max size for full-content downloads. |
| `fullContentTimeoutSeconds` | `number` | `30` | Timeout for full-content downloads. |

### Region and base URL

| Region | API base URL | Full-content download domain |
|--------|-------------|------------------------------|
| `global` | `https://qveris.ai/api/v1` | `qveris.ai` |
| `cn` | `https://qveris.cn/api/v1` | `qveris.cn` |

---

## Minimal vs full config examples

### Minimal (global region, env var key)

```bash
export QVERIS_API_KEY=qv-...
```

```json5
{
  plugins: {
    allow: ["qveris"],
    entries: { qveris: { enabled: true } }
  },
  tools: { alsoAllow: ["qveris"] }
}
```

### China region

```json5
{
  plugins: {
    allow: ["qveris"],
    entries: {
      qveris: {
        enabled: true,
        config: {
          apiKey: "qv-...",
          region: "cn"
        }
      }
    }
  },
  tools: { alsoAllow: ["qveris"] }
}
```

### With full-content materialization enabled

```json5
{
  plugins: {
    allow: ["qveris"],
    entries: {
      qveris: {
        enabled: true,
        config: {
          apiKey: "qv-...",
          region: "global",
          autoMaterializeFullContent: true,
          fullContentMaxBytes: 20971520,    // 20 MB
          fullContentTimeoutSeconds: 60,
          executeTimeoutSeconds: 120         // for slow image/video generation tools
        }
      }
    }
  },
  tools: { alsoAllow: ["qveris"] }
}
```

---

## Verification

After restarting the gateway, verify the plugin is loaded and tools are registered:

```bash
# Restart gateway
openclaw gateway restart

# Inspect plugin
openclaw plugins inspect qveris
```

Expected output should include:

```
Status: loaded
Tools:
qveris_discover, qveris_call, qveris_inspect
```

---

## Troubleshooting

### Tools not visible to the agent

Make sure `tools.alsoAllow: ["qveris"]` is set. Without this, plugin tools are excluded from the tool list sent to the LLM even if the plugin is loaded.

### Plugin loaded but tools missing from `plugins inspect`

The API key is not configured. Check:

```bash
openclaw config get plugins.entries.qveris
# or
echo $QVERIS_API_KEY
```

### `plugin id mismatch` warning on startup

Your npm package name must unscopе to match the plugin id `qveris`. The correct package name is `@qverisai/qveris` (not `@qverisai/openclaw-qveris-plugin`).

### `Cannot find module '@.../dist/plugin-sdk/root-alias.cjs/plugin-entry'`

The OpenClaw host's `dist/` is not built. Either:
- Use the official `openclaw` npm package as the host, or
- Run `pnpm build` in the OpenClaw fork before loading the plugin.

---

## License

MIT
