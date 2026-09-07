# QVeris MCP Server setup

QVeris lets the Zed Agent discover, inspect, and call external data and tool APIs through one MCP server.

1. Create a QVeris account and API key at [QVeris API Keys](https://qveris.ai/account?page=api-keys).
2. Paste the key into the `qveris_api_key` setting below.

Discovering and inspecting capabilities is free. Calling a capability may consume QVeris credits; the tool response includes billing information, and usage can be audited with the server's usage tools.

Zed's default tool permission asks for approval before running MCP tool actions. You can review or change that behavior in Zed's Tool Permissions settings.

The optional `qveris_base_url` setting is only needed for a self-hosted or regional deployment. Leave it as `null` to use the default QVeris API.
