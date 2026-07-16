<a id="python-sdk-api-reference"></a>

# Python SDK API reference

This reference is generated from the public Python objects and docstrings. See the Python SDK guide for installation, authentication, and complete workflows.

<a id="client"></a>

## Client

<a id="qveris.QverisClient"></a>

### *class* qveris.QverisClient(config: [QverisConfig](#qveris.QverisConfig) | None = None, debug_callback: Callable[[str], None] | None = None)

Async client for Qveris API.

<a id="qveris.QverisClient.rate_limit_retries"></a>

#### *property* rate_limit_retries *: int*

How many times the client has backed off on a 429/503 so far.

Rate-limit backoff is retried pressure, not failure — surface this rather than counting the retried responses as errors.

<a id="qveris.QverisClient.close"></a>

#### *async* close()

Close the underlying HTTP client.

Call this if you create QverisClient directly and want to free network resources.

<a id="qveris.QverisClient.discover"></a>

#### *async* discover(query: str, limit: int = 20, session_id: str | None = None) → [SearchResponse](#qveris.SearchResponse)

Discover capabilities using natural language.

* **Parameters:**
  * **query** – Natural-language description of the capability you want (not parameters). Example: “weather forecast API” or “search recent news”.
  * **limit** – Maximum number of tools to return (server may cap this).
  * **session_id** – Optional correlation id.
* **Returns:**
  SearchResponse containing results (tools) and search_id used for execution.

<a id="qveris.QverisClient.search_tools"></a>

#### *async* search_tools(query: str, limit: int = 20, session_id: str | None = None) → [SearchResponse](#qveris.SearchResponse)

Deprecated alias for discover(…).

<a id="qveris.QverisClient.inspect"></a>

#### *async* inspect(tool_ids: Iterable[str] | str, search_id: str | None = None, session_id: str | None = None) → [SearchResponse](#qveris.SearchResponse)

Inspect one or more capabilities by tool ID.

* **Parameters:**
  * **tool_ids** – Tool IDs returned by discover(…). A single string is accepted.
  * **search_id** – Optional search ID that produced the tools.
  * **session_id** – Optional correlation ID.
* **Returns:**
  SearchResponse with full tool details for the requested IDs.

<a id="qveris.QverisClient.get_tools_by_ids"></a>

#### *async* get_tools_by_ids(tool_ids: Iterable[str] | str, search_id: str | None = None, session_id: str | None = None) → [SearchResponse](#qveris.SearchResponse)

Deprecated alias for inspect(…).

<a id="qveris.QverisClient.call"></a>

#### *async* call(tool_id: str, parameters: Dict[str, Any], search_id: str | None = None, session_id: str | None = None, max_response_size: int | None = None) → [ToolExecutionResponse](#qveris.ToolExecutionResponse)

Call a specific capability.

* **Parameters:**
  * **tool_id** – Tool identifier returned by discover(…).
  * **parameters** – JSON-serializable parameters for the tool.
  * **search_id** – Search ID returned by discover(…) (recommended for traceability).
  * **session_id** – Optional correlation id.
  * **max_response_size** – Optional max response size in bytes. Large responses may be truncated.
* **Returns:**
  ToolExecutionResponse with success, result, and metadata.

<a id="qveris.QverisClient.execute_tool"></a>

#### *async* execute_tool(tool_id: str, parameters: Dict[str, Any], search_id: str | None = None, session_id: str | None = None, max_response_size: int | None = None) → [ToolExecutionResponse](#qveris.ToolExecutionResponse)

Deprecated alias for call(…).

<a id="qveris.QverisClient.usage"></a>

#### *async* usage(\*, start_date: str | None = None, end_date: str | None = None, summary: bool | None = True, bucket: str | None = None, event_type: str | None = None, kind: str | None = None, success: bool | None = None, charge_outcome: str | None = None, search_id: str | None = None, execution_id: str | None = None, min_credits: float | None = None, max_credits: float | None = None, limit: int | None = None, page: int | None = None, page_size: int | None = None) → [UsageHistoryResponse](#qveris.UsageHistoryResponse)

Query request-level usage audit history.

Use this to verify success, failure, charge outcome, and final settlement context for discover/inspect/call activity.

<a id="qveris.QverisClient.ledger"></a>

#### *async* ledger(\*, start_date: str | None = None, end_date: str | None = None, summary: bool | None = True, bucket: str | None = None, entry_type: str | None = None, direction: str | None = None, min_credits: float | None = None, max_credits: float | None = None, limit: int | None = None, page: int | None = None, page_size: int | None = None) → [CreditsLedgerResponse](#qveris.CreditsLedgerResponse)

Query final credits ledger entries.

Use this when you need authoritative credit balance movements rather than pre-settlement billing hints returned by call(…).

<a id="qveris.QverisClient.handle_tool_call"></a>

#### *async* handle_tool_call(func_name: str, func_args: Dict[str, Any], session_id: str | None = None) → Tuple[Any, bool, bool]

Handle a built-in Qveris tool call from an LLM response.

* **Parameters:**
  * **func_name** – The name of the function/tool to call
  * **func_args** – The arguments parsed from the LLM response
  * **session_id** – Optional session ID for tracking
* **Returns:**
  - result: the tool output (None if not handled)
  - is_error: True if an error occurred
  - handled: True if this was a Qveris tool and was processed
* **Return type:**
  Tuple of (result, is_error, handled) where

### Notes

- params_to_tool may be either a dict (canonical) or a JSON string (legacy).
- If func_name is not a Qveris built-in, (None, False, False) is returned so that callers can route to their own tool handlers.

<a id="agent"></a>

## Agent

<a id="qveris.Agent"></a>

### *class* qveris.Agent(config: [QverisConfig](#qveris.QverisConfig) | None = None, agent_config: [AgentConfig](#qveris.AgentConfig) | None = None, llm_provider: LLMProvider | None = None, extra_tools: List[ChatCompletionFunctionToolParam] | None = None, extra_tool_handler: Callable[[str, Dict[str, Any]], Awaitable[Any]] | None = None, debug_callback: Callable[[str], None] | None = None, budget_credits: float | None = None)

Qveris agent orchestrator.

The agent runs an LLM/tool loop that can:

- discover capabilities via Qveris (discover),
- inspect candidate capabilities (inspect),
- call a selected capability (call),
- optionally execute additional user-provided tools (extra_tools + extra_tool_handler).

* **Parameters:**
  * **config** – Qveris API / agent runtime configuration (API key, base URL, max iterations, etc.).
  * **agent_config** – LLM configuration (model name, temperature, additional system prompt, …).
  * **llm_provider** – Provider implementation that follows LLMProvider. If omitted, uses the built-in OpenAI-compatible provider (OpenAIProvider).
  * **extra_tools** – Optional additional tool schemas (OpenAI ChatCompletionToolParam) exposed to the LLM. These are **not** executed by Qveris unless you also provide extra_tool_handler.
  * **extra_tool_handler** – Async callback invoked for non-Qveris tool calls. Signature: async def handler(func_name: str, func_args: dict) -> Any.
  * **debug_callback** – Optional callback used by QverisClient to emit debug messages (request/response logs, with authorization redacted).

### Notes

- A session id is created at construction time; call new_session() to reset it.
- This class is safe to reuse across multiple conversations; pass your own messages list.

<a id="qveris.Agent.close"></a>

#### *async* close() → None

Close network resources owned by the agent.

Call this when you are done with a long-lived Agent, or use the agent as an async context manager so cleanup happens automatically.

<a id="qveris.Agent.get_last_messages"></a>

#### get_last_messages() → List[[Message](#qveris.Message)]

Return the latest conversation history produced by run(…).

The returned history includes intermediate assistant tool calls and tool results, plus the final assistant content when one was produced. If run(…) injected the default system prompt, that internal system message is omitted so callers can reuse the list directly.

<a id="qveris.Agent.budget_status"></a>

#### budget_status() → Dict[str, Any] | None

Return the current budget state (`limit` / `spent` / `remaining`).

Returns `None` when no `budget_credits` was set. `spent` reflects pre-settlement charges from `call` responses; reconcile final charges with `usage(...)` / `ledger(...)`.

<a id="qveris.Agent.run"></a>

#### *async* run(messages: List[[Message](#qveris.Message)], stream: bool = True) → AsyncGenerator[[StreamEvent](#qveris.StreamEvent), None]

Run the agent loop and yield events as they occur.

This is the primary integration API. In streaming mode (stream=True), the underlying provider is expected to yield delta content chunks; in non-streaming mode, this method yields a single content event for the assistant message.

Tool calls are always surfaced as tool_call events, and tool executions as tool_result.

* **Parameters:**
  * **messages** – Conversation history (typically starts with role=”user”).
  * **stream** – If True, yields content as delta chunks (streaming). If False, yields content as complete text (non-streaming).
* **Yields:**
  StreamEvent objects for content, reasoning, reasoning_details, tool_call, tool_result, metrics, and error.

<a id="qveris.Agent.run_to_completion"></a>

#### *async* run_to_completion(messages: List[[Message](#qveris.Message)]) → str

Run the agent in non-streaming mode and return the final assistant text.

This is a convenience wrapper around run(messages, stream=False) that discards all events except content and returns the concatenated text.

<a id="qveris.Agent.new_session"></a>

#### new_session() → str

Create and set a new session id.

The session id is forwarded to Qveris API calls (discover/call) and can be used server-side for correlation, tracing, and analytics.

<a id="qveris.BudgetTracker"></a>

### *class* qveris.BudgetTracker(limit: float | None = None, warn_ratio: float = 0.8)

Track and enforce a per-session credit budget.

* **Parameters:**
  * **limit** – Maximum credits the session may spend. `None` disables the tracker entirely.
  * **warn_ratio** – Emit a single warning once cumulative spend first reaches this fraction of `limit` (default 0.8).

### Notes

- Best-effort, not a hard cap: blocking uses the pre-call `expected_cost` estimate while `spent` accumulates the actual (possibly larger) charge, so a call estimated under-budget that charges more can push `spent` past `limit`. The guard is only as tight as `discover` / `inspect` coverage — a call whose cost was never observed cannot be estimated and is not blocked.
- The tracker is per-`Agent` session state, not per-`run()`. Don’t share one `Agent` across concurrent `run()` calls if you rely on the budget: they share and race `spent`.

<a id="qveris.BudgetTracker.observe"></a>

#### observe(result: Any) → None

Cache `expected_cost` per `tool_id` from a discover/inspect payload.

Accepts a dict or a pydantic `SearchResponse`.

<a id="qveris.BudgetTracker.estimate"></a>

#### estimate(tool_id: str | None) → float | None

Return the cached cost estimate for `tool_id`, if known.

<a id="qveris.BudgetTracker.check"></a>

#### check(tool_id: str | None) → Dict[str, Any] | None

Return a block payload if calling `tool_id` would exceed the budget.

Returns `None` (allowed) when the tracker is disabled, the cost is unknown (cannot estimate, so not blocked), or the projected spend is within the limit.

<a id="qveris.BudgetTracker.record"></a>

#### record(execution: Any) → Dict[str, Any] | None

Add the actual charge from a `call` result to cumulative spend.

Returns a warning payload the first time spend reaches `warn_ratio * limit`; otherwise `None`.

<a id="qveris.BudgetTracker.snapshot"></a>

#### snapshot() → Dict[str, Any]

Return the current budget state (queryable, reconcilable with usage/ledger).

<a id="configuration"></a>

## Configuration

<a id="qveris.QverisConfig"></a>

### *class* qveris.QverisConfig

Configuration for Qveris connectivity and agent loop limits.

This config is used by:

- qveris.client.api.QverisClient (API key, base URL)
- qveris.agent.core.Agent (loop controls like history pruning and max iterations)

<a id="qveris.AgentConfig"></a>

### *class* qveris.AgentConfig

Configuration for LLM behavior used by Agent.

### Notes

- model is passed to the active LLMProvider implementation.
- additional_system_prompt is appended to the default system prompt used for tool use.
- temperature is forwarded to the provider (if supported).

<a id="response-models"></a>

## Response models

<a id="qveris.CompactBillingStatement"></a>

### *class* qveris.CompactBillingStatement(\*, price: BillingPrice | None = None, quantity: float | None = None, charge_lines: List[BillingChargeLine] | None = None, minimum_charge_credits: float | None = None, list_amount_credits: float | None = None, requested_amount_credits: float | None = None, summary: str | None = None, \*\*extra_data: Any)

<a id="qveris.CreditsLedgerItem"></a>

### *class* qveris.CreditsLedgerItem(\*, id: str, entry_type: str, amount_credits: float, source_system: str, created_at: str, source_ref_type: str | None = None, source_ref_id: str | None = None, pre_settlement_bill: Dict[str, Any] | None = None, settlement_result: Dict[str, Any] | None = None, balance_before: Dict[str, Any] | None = None, balance_after: Dict[str, Any] | None = None, ledger_metadata: Dict[str, Any] | None = None, description: str | None = None, \*\*extra_data: Any)

<a id="qveris.CreditsLedgerResponse"></a>

### *class* qveris.CreditsLedgerResponse(\*, items: ~typing.List[~qveris.types.CreditsLedgerItem] = <factory>, total: int = 0, page: int = 1, page_size: int = 0, summary: ~typing.Dict[str, ~typing.Any] | None = None, \*\*extra_data: ~typing.Any)

<a id="qveris.Message"></a>

### *class* qveris.Message(\*, role: str, content: str | None = None, tool_calls: List[Dict[str, Any]] | None = None, tool_call_id: str | None = None, name: str | None = None, reasoning_details: Any | None = None, \*\*extra_data: Any)

<a id="qveris.SearchResponse"></a>

### *class* qveris.SearchResponse(\*, query: str | None = None, search_id: str | None = None, total: int | None = None, results: ~typing.List[~qveris.types.ToolInfo] = <factory>, stats: ~qveris.types.SearchStats | None = None, remaining_credits: float | None = None, elapsed_time_ms: float | None = None, \*\*extra_data: ~typing.Any)

<a id="qveris.StreamEvent"></a>

### *class* qveris.StreamEvent(\*, type: Literal['content', 'reasoning', 'tool_call', 'tool_result', 'metrics', 'error', 'reasoning_details', 'budget_warning', 'budget_exceeded'], content: str | None = None, tool_call: Dict[str, Any] | None = None, tool_result: Dict[str, Any] | None = None, metrics: Dict[str, Any] | None = None, error: str | None = None, details: Any | None = None, budget: Dict[str, Any] | None = None, \*\*extra_data: Any)

<a id="qveris.ToolCapability"></a>

### *class* qveris.ToolCapability(\*, id: str | None = None, tag: List[[ToolCapabilityTag](#qveris.ToolCapabilityTag)] | None = None, \*\*extra_data: Any)

Standardized capability descriptor attached to a tool.

Example: `MKT.BARS.ADJUSTED` with market coverage tags.

<a id="qveris.ToolCapabilityTag"></a>

### *class* qveris.ToolCapabilityTag(\*, id: str | None = None, name: str | None = None, type: str | None = None, description: str | None = None, \*\*extra_data: Any)

Coverage tag attached to a capability (e.g. market coverage).

<a id="qveris.ToolCategory"></a>

### *class* qveris.ToolCategory(\*, slug: str | None = None, name: str | None = None, description: str | None = None, \*\*extra_data: Any)

Category/tag attached to a tool.

Current API responses return category objects; legacy responses returned plain strings, so `ToolInfo.categories` accepts both.

<a id="qveris.ToolExecutionResponse"></a>

### *class* qveris.ToolExecutionResponse(\*, execution_id: str, success: bool, result: Any | None = None, error_message: str | None = None, elapsed_time_ms: float | None = None, execution_time: float | None = None, tool_id: str | None = None, parameters: Dict[str, Any] | None = None, cost: float | None = None, billing: [CompactBillingStatement](#qveris.CompactBillingStatement) | None = None, pre_settlement_bill: Dict[str, Any] | None = None, remaining_credits: float | None = None, created_at: str | None = None, \*\*extra_data: Any)

<a id="qveris.ToolInfo"></a>

### *class* qveris.ToolInfo(\*, tool_id: str, name: str | None = None, description: Any | None = None, categories: List[str | [ToolCategory](#qveris.ToolCategory)] | None = None, category: str | None = None, capabilities: List[[ToolCapability](#qveris.ToolCapability)] | None = None, provider_id: str | None = None, provider_name: str | None = None, provider_description: Any | None = None, provider_website_url: str | None = None, region: str | None = None, params: List[[ToolParameter](#qveris.ToolParameter)] | None = None, examples: ToolExamples | None = None, stats: ToolStats | None = None, billing_rule: BillingRule | None = None, expected_cost: str | float | None = None, final_score: float | None = None, score: float | None = None, why_recommended: str | None = None, has_last_execution: bool | None = None, last_execution_record: Dict[str, Any] | None = None, docs_url: str | None = None, protocol: str | None = None, \*\*extra_data: Any)

<a id="qveris.ToolParameter"></a>

### *class* qveris.ToolParameter(\*, name: str, type: Any, required: bool = False, description: Any | None = None, enum: List[Any] | None = None, \*\*extra_data: Any)

<a id="qveris.UsageEventItem"></a>

### *class* qveris.UsageEventItem(\*, id: str, event_type: str, source_system: str, success: bool, created_at: str, kind: str | None = None, source_ref_type: str | None = None, source_ref_id: str | None = None, session_id: str | None = None, search_id: str | None = None, execution_id: str | None = None, tool_id: str | None = None, model: str | None = None, query: str | None = None, charge_outcome: str | None = None, error_message: str | None = None, billing_snapshot_status: str | None = None, pre_settlement_bill: Dict[str, Any] | None = None, settlement_result: Dict[str, Any] | None = None, requested_amount_credits: float | None = None, actual_amount_credits: float | None = None, credits_ledger_entry_id: str | None = None, display_target: str | None = None, billing_summary: str | None = None, pre_settlement_amount_credits: float | None = None, settled_amount_credits: float | None = None, \*\*extra_data: Any)

<a id="qveris.UsageHistoryResponse"></a>

### *class* qveris.UsageHistoryResponse(\*, items: ~typing.List[~qveris.types.UsageEventItem] = <factory>, total: int = 0, page: int = 1, page_size: int = 0, summary: ~typing.Dict[str, ~typing.Any] | None = None, \*\*extra_data: ~typing.Any)
