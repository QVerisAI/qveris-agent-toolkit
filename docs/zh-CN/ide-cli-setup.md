# IDE 与 CLI 配置指南

QVeris 已集成到多种 IDE 和 CLI 编程工具中。通过自动配置 QVeris MCP 和技能/规则，可以大幅简化基于 QVeris API 和工具的应用开发。

## 图形界面 IDE

对于图形界面 IDE，请按照[插件页面](/plugins)的说明安装对应插件。

## CLI 编程工具

对于 CLI 编程工具，请访问以下对应页面查看配置说明。

- [Codex 与 ChatGPT 桌面端](codex-setup.md)
- [Claude Code](claude-code-setup.md)
- [OpenCode](opencode-setup.md)

## 通过编程智能体自动配置

### 消费复制的服务/任务上下文

IDE 或编程智能体收到从安装页复制的 v1 JSON 上下文时，请使用 CLI 作为唯一严格消费者：

```bash
qveris call --context @context.json --params @params.json
```

不要把参数、提示词、凭证或私有 payload 放入 `context.json`；应根据当前用户请求构建 `params.json`。CLI 会校验版本与有效期、拒绝未知/重复/敏感字段，并在 Call 前重新 Discover、Inspect 和 Probe。复制的 ID 不能证明可用性、价格、权限、结果有效性或最终结算。若重新发现失败，请返回发现入口获取新上下文，不要强制使用旧 ID。

你也可以让编程智能体代为完成配置。只需将配置指南链接和你的 API 密钥提供给智能体：

```
请按照 <配置指南链接> 帮我完成配置。API 密钥是 <你的 API 密钥>
```

大多数有能力的编程智能体都能自动完成配置并解决遇到的问题。

### 示例

Codex：
```
请按照 <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/zh-CN/codex-setup.md> 帮我完成配置。API 密钥是 sk-xxxxxxxxxxxxx
```

Claude Code：
```
请按照 <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/zh-CN/claude-code-setup.md> 帮我完成配置。API 密钥是 sk-xxxxxxxxxxxxx
```

OpenCode：
```
请按照 <https://github.com/QVerisAI/qveris-agent-toolkit/blob/main/docs/zh-CN/opencode-setup.md> 帮我完成配置。API 密钥是 sk-xxxxxxxxxxxxx
```
