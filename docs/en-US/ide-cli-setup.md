# IDE and CLI Configuration Guide

QVeris has integration in various IDEs and CLI coding tools. They can ease the development of applications using QVeris's APIs and tools by setting up QVeris MCP and skill/rule automatically.

## GUI IDEs

For GUI IDEs, follow the instructions on the [Plugins page](/plugins) to install the plugins.

## CLI Coding Tools

For CLI coding tools, follow the instructions at the following corresponding pages.

- [Codex and ChatGPT desktop](codex-setup.md)
- [Claude Code](claude-code-setup.md)
- [OpenCode](opencode-setup.md)

## Automated Setup with Coding Agents

### Consuming copied service/task context

When an IDE or coding agent receives a v1 JSON context copied from the installation page, use the CLI as the single strict consumer:

```bash
qveris call --context @context.json --params @params.json
```

Do not put parameters, prompts, credentials, or private payloads in `context.json`; construct `params.json` from the current user request. The CLI strictly rejects sensitive/executable content, ignores ordinary unknown fields with warnings, and runs a fresh Discover when snapshots expire. Inspect and Probe run only when the current contract, parameters, or pricing policy require them; service-only context returns candidates without guessing a tool. A copied ID does not establish availability, price, permission, result validity, or final settlement.

You can also tell your coding agents to set it up for you. Simply provide them with the configuration guide URL and your API key:

```
Configure this for me <THE_URL_TO_CONFIGURATION_GUIDE>. The API key is <YOUR_API_KEY>
```

Most capable coding agents can finish the setup and resolve issues automatically.

### Example

For Codex:
```
Configure this for me <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/en-US/codex-setup.md>. The API key is sk-xxxxxxxxxxxxx
```

For Claude Code:
```
Configure this for me <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/en-US/claude-code-setup.md>. The API key is sk-xxxxxxxxxxxxx
```

For OpenCode:
```
Configure this for me <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/en-US/opencode-setup.md>. The API key is sk-xxxxxxxxxxxxx
```
