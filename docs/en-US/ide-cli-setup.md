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
