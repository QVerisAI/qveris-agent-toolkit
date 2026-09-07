# QVeris MCP Server for Zed

This extension makes the official [QVeris MCP server](https://github.com/QVerisAI/qveris-agent-toolkit/tree/main/packages/mcp) available in Zed's Agent Panel.

QVeris provides a compact set of MCP tools for discovering, inspecting, validating, and calling external capabilities. It also exposes usage and credits-ledger tools for billing audit.

## Install

After the extension is published:

1. Open **Settings → AI → MCP Servers** in Zed.
2. Choose **Add Server → Install from Extensions**.
3. Search for **QVeris MCP Server** and install it.
4. Create an API key at [QVeris API Keys](https://qveris.ai/account?page=api-keys) and enter it in the extension settings.
5. Enable the server in the tools menu for your active Agent profile.

For development, open Zed's Extensions page, choose **Install Dev Extension**, and select this directory.

## Settings

```jsonc
{
  "context_servers": {
    "mcp-server-qveris": {
      "settings": {
        "qveris_api_key": "your-api-key",
        "qveris_base_url": null,
      },
    },
  },
}
```

- `qveris_api_key` is required. Zed stores it with this context server's settings and the extension passes it to the local QVeris MCP server process as `QVERIS_API_KEY`.
- `qveris_base_url` is optional. Leave it as `null` for the default QVeris API.

Discovering and inspecting capabilities is free. Calling a capability may consume QVeris credits according to the capability's billing rule.
Zed's default tool permission asks for approval before running MCP tool actions; this can be reviewed in Zed's Tool Permissions settings.

## Runtime

The extension uses Zed's extension API to download the pinned `@qverisai/mcp@0.14.1` npm package into the extension work directory. The MCP server is not bundled with this extension and no system files or shell startup files are modified.

## License

MIT. See [LICENSE](LICENSE).
