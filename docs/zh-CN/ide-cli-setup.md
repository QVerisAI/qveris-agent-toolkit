# IDE 与 CLI 配置指南

QVeris 已集成到多种 IDE 和 CLI 编程工具中。通过自动配置 QVeris MCP 和技能/规则，可以大幅简化基于 QVeris API 和工具的应用开发。

## 图形界面 IDE

对于图形界面 IDE，请访问 [https://qveris.ai/plugins](https://qveris.ai/plugins) 按照说明安装对应插件。

## CLI 编程工具

对于 CLI 编程工具，请访问以下对应页面查看配置说明。

## 通过编程 Agent 自动配置

你也可以让编程 Agent 代为完成配置。只需将配置指南链接和你的 API 密钥提供给 Agent：

```
Configure this for me <配置指南链接>. The API key is <你的 API 密钥>
```

大多数有能力的编程 Agent 都能自动完成配置并解决遇到的问题。

### 示例

Claude Code：
```
Configure this for me https://github.com/QVerisAI/QVerisAI/blob/main/docs/claude-code-setup.md. The API key is sk-xxxxxxxxxxxxx
```

OpenCode：
```
Configure this for me https://github.com/QVerisAI/QVerisAI/blob/main/docs/opencode-setup.md. The API key is sk-xxxxxxxxxxxxx
```
