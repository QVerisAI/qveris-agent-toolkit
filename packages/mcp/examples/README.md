# QVeris MCP server examples

Runnable examples for driving `@qverisai/mcp` the way an agent runtime does.

## Agent loop

[`agent-loop.ts`](agent-loop.ts) spawns the MCP server as a subprocess, speaks
MCP over stdio, lists the tools, and runs the discover → inspect → call loop by
calling those tools — the same shape a model follows.

```bash
npx tsx examples/agent-loop.ts                                   # lists tools (no key needed)
QVERIS_API_KEY=sk-... npx tsx examples/agent-loop.ts             # discover -> inspect (no charge)
QVERIS_API_KEY=sk-... RUN_QVERIS_CALLS=1 npx tsx examples/agent-loop.ts   # also executes a capability
```

The server starts even without `QVERIS_API_KEY` — tool listing works and calls
return an actionable error — so this runs unconfigured. The `call` step is
additionally gated behind `RUN_QVERIS_CALLS=1` so it never spends credits by
accident.

To wire the server into an agent host instead of driving it from code, see the
client-config snippets in the [package README](../README.md).
