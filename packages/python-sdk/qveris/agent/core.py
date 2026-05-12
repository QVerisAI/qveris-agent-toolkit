"""
Qveris agent runtime.

This module defines `Agent`, the high-level orchestration layer that connects:

- an LLM provider (`LLMProvider`) capable of emitting tool calls,
- Qveris built-in tools (`discover`, `inspect`, `call`) exposed to the LLM,
- optional user-provided tools and a handler for those tools,
- and an execution loop that feeds tool results back to the LLM until completion.

## Event model

`Agent.run(...)` yields `StreamEvent` objects. Depending on the chosen provider and whether
streaming is enabled, you may see:

- `content`: assistant output (delta chunks in streaming mode, whole message in non-streaming)
- `reasoning`: optional reasoning tokens from some providers
- `reasoning_details`: optional structured reasoning details (e.g. Gemini thought signatures via OpenRouter)
- `tool_call`: a tool call the model wants to invoke (OpenAI-compatible tool-call dict)
- `tool_result`: the result of executing a tool call (Qveris built-ins or your extra tools)
- `metrics`: token usage / timing metrics if the provider reports them
- `error`: fatal error that stops the run

## Tool call lifecycle

When the LLM requests one or more tool calls:

1. the assistant message (with tool calls) is appended to the conversation,
2. each tool is executed in sequence,
3. the tool results are appended as `role="tool"` messages,
4. the loop continues with the updated conversation.
"""

import inspect
import json
import uuid
from typing import Any, AsyncGenerator, Awaitable, Callable, Dict, List, Optional

import httpx
from openai import APIConnectionError, APIStatusError, APITimeoutError, AuthenticationError, RateLimitError
from openai.types.chat import ChatCompletionToolParam

from ..client.api import QverisClient
from ..client.tools import CALL_TOOL_DEF, DEFAULT_SYSTEM_PROMPT, DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF
from ..config import AgentConfig, QverisConfig
from ..llm.base import LLMProvider
from ..llm.openai import OpenAIProvider
from ..types import ChatResponse, Message, StreamEvent
from .memory import prune_tool_history

# Type alias for extra tool handler callback.
# Called only when the tool call is NOT a built-in Qveris tool.
ExtraToolHandler = Callable[[str, Dict[str, Any]], Awaitable[Any]]

class Agent:
    """
    Qveris agent orchestrator.

    The agent runs an LLM/tool loop that can:

    - discover capabilities via Qveris (`discover`),
    - inspect candidate capabilities (`inspect`),
    - call a selected capability (`call`),
    - optionally execute additional user-provided tools (`extra_tools` + `extra_tool_handler`).

    Parameters:
        config:
            Qveris API / agent runtime configuration (API key, base URL, max iterations, etc.).
        agent_config:
            LLM configuration (model name, temperature, additional system prompt, ...).
        llm_provider:
            Provider implementation that follows `LLMProvider`. If omitted, uses the built-in
            OpenAI-compatible provider (`OpenAIProvider`).
        extra_tools:
            Optional additional tool schemas (OpenAI `ChatCompletionToolParam`) exposed to the LLM.
            These are **not** executed by Qveris unless you also provide `extra_tool_handler`.
        extra_tool_handler:
            Async callback invoked for non-Qveris tool calls. Signature:
            `async def handler(func_name: str, func_args: dict) -> Any`.
        debug_callback:
            Optional callback used by `QverisClient` to emit debug messages (request/response logs,
            with authorization redacted).

    Notes:
        - A session id is created at construction time; call `new_session()` to reset it.
        - This class is safe to reuse across multiple conversations; pass your own `messages` list.
    """
    def __init__(
        self,
        config: Optional[QverisConfig] = None,
        agent_config: Optional[AgentConfig] = None,
        llm_provider: Optional[LLMProvider] = None,
        extra_tools: Optional[List[ChatCompletionToolParam]] = None,
        extra_tool_handler: Optional[ExtraToolHandler] = None,
        debug_callback: Optional[Callable[[str], None]] = None
    ):
        self.config = config or QverisConfig()
        self.agent_config = agent_config or AgentConfig()

        # Setup API Client with debug callback
        self.client = QverisClient(self.config, debug_callback=debug_callback)

        # Setup LLM Provider
        if llm_provider:
            self.llm = llm_provider
        else:
            # Fallback to internal OpenAI provider
            self.llm = OpenAIProvider()

        self.tools: List[ChatCompletionToolParam] = [DISCOVER_TOOL_DEF, INSPECT_TOOL_DEF, CALL_TOOL_DEF]
        if extra_tools:
            self.tools.extend(extra_tools)

        # Handler for extra tools not built into Qveris
        self.extra_tool_handler = extra_tool_handler

        # Setup new session
        self.new_session()

        self.last_messages: List[Message] = []

    async def close(self) -> None:
        """
        Close network resources owned by the agent.

        Call this when you are done with a long-lived `Agent`, or use the agent as an async
        context manager so cleanup happens automatically.
        """
        await self.client.close()

        close_llm = getattr(self.llm, "close", None)
        if callable(close_llm):
            result = close_llm()
            if inspect.isawaitable(result):
                await result

    async def __aenter__(self) -> "Agent":
        return self

    async def __aexit__(self, exc_type: Any, exc: Any, tb: Any) -> None:
        await self.close()

    @staticmethod
    def _llm_error_event(error: Exception) -> StreamEvent:
        """Convert provider/client exceptions into user-facing agent error events."""
        if isinstance(error, httpx.TimeoutException):
            return StreamEvent(type="error", error=f"LLM request timed out: {error}")
        if isinstance(error, httpx.ConnectError):
            return StreamEvent(type="error", error=f"Failed to connect to LLM service: {error}")
        if isinstance(error, httpx.HTTPStatusError):
            return StreamEvent(
                type="error",
                error=f"LLM HTTP error {error.response.status_code}: {error.response.text[:200]}"
            )
        if isinstance(error, AuthenticationError):
            return StreamEvent(type="error", error=f"LLM authentication failed: {error}")
        if isinstance(error, RateLimitError):
            return StreamEvent(type="error", error=f"LLM rate limit exceeded: {error}")
        if isinstance(error, (APIConnectionError, APITimeoutError)):
            return StreamEvent(type="error", error=f"LLM connection error: {error}")
        if isinstance(error, APIStatusError):
            return StreamEvent(type="error", error=f"LLM API error {error.status_code}: {error}")
        return StreamEvent(type="error", error=f"LLM error: {error}")

    def _record_last_messages(self, current_messages: List[Message], inserted_system_prompt: bool) -> None:
        messages_for_caller = current_messages[1:] if inserted_system_prompt else current_messages
        self.last_messages = [message.model_copy(deep=True) for message in messages_for_caller]

    def get_last_messages(self) -> List[Message]:
        """
        Return the latest conversation history produced by `run(...)`.

        The returned history includes intermediate assistant tool calls and tool results, plus the
        final assistant content when one was produced. If `run(...)` injected the default system
        prompt, that internal system message is omitted so callers can reuse the list directly.
        """
        return [message.model_copy(deep=True) for message in self.last_messages]

    async def run(
        self,
        messages: List[Message],
        stream: bool = True
    ) -> AsyncGenerator[StreamEvent, None]:
        """
        Run the agent loop and yield events as they occur.

        This is the primary integration API. In streaming mode (`stream=True`), the underlying
        provider is expected to yield delta `content` chunks; in non-streaming mode, this method
        yields a single `content` event for the assistant message.

        Tool calls are always surfaced as `tool_call` events, and tool executions as `tool_result`.

        Args:
            messages: Conversation history (typically starts with `role="user"`).
            stream: If True, yields content as delta chunks (streaming).
                    If False, yields content as complete text (non-streaming).

        Yields:
            StreamEvent objects for content, reasoning, reasoning_details, tool_call, tool_result,
            metrics, and error.
        """
        # 1. Setup Messages
        current_messages = [m.model_copy() for m in messages]

        # Add System Prompt
        system_prompt = DEFAULT_SYSTEM_PROMPT
        if self.agent_config.additional_system_prompt:
            system_prompt += '\n' + self.agent_config.additional_system_prompt

        inserted_system_prompt = False
        if not current_messages or current_messages[0].role != "system":
            current_messages.insert(0, Message(role="system", content=system_prompt))
            inserted_system_prompt = True
        else:
            existing_system_prompt = current_messages[0].content or ""
            if not existing_system_prompt.startswith(system_prompt):
                separator = "\n\n" if existing_system_prompt else ""
                current_messages[0].content = system_prompt + separator + existing_system_prompt

        self._record_last_messages(current_messages, inserted_system_prompt)

        iteration = 0
        should_continue = True
        previous_messages_count = len(current_messages)

        while should_continue and iteration < self.config.max_iterations:
            iteration += 1

            # Prune history to save tokens if enabled
            messages_to_send = current_messages
            if self.config.enable_history_pruning:
                messages_to_send = prune_tool_history(current_messages, previous_messages_count)
            previous_messages_count = len(messages_to_send)

            tool_calls: List[Dict[str, Any]] = []
            content_accumulated = ""
            reasoning_details_accumulated = []

            try:
                if stream:
                    # Streaming mode: yield delta chunks
                    llm_stream = self.llm.chat_stream(
                        messages=messages_to_send,
                        tools=self.tools,
                        config=self.agent_config
                    )

                    async for event in llm_stream:
                        if event.type in ["content", "reasoning"]:
                            yield event
                            if event.type == "content" and event.content:
                                content_accumulated += event.content
                        elif event.type == "reasoning_details":
                            # Accumulate reasoning_details for Gemini thought signatures
                            if event.details:
                                reasoning_details_accumulated.extend(event.details)
                            yield event
                        elif event.type == "tool_call":
                            tool_calls.append(event.tool_call)
                            yield event
                        elif event.type == "metrics":
                            yield event
                else:
                    # Non-streaming mode: get complete response, yield as single event
                    response: ChatResponse = await self.llm.chat(
                        messages=messages_to_send,
                        tools=self.tools,
                        config=self.agent_config
                    )

                    # Yield complete content as single event
                    if response.content:
                        content_accumulated = response.content
                        yield StreamEvent(type="content", content=response.content)

                    # Capture reasoning_details for Gemini thought signatures
                    if response.reasoning_details:
                        reasoning_details_accumulated = response.reasoning_details
                        yield StreamEvent(type="reasoning_details", details=response.reasoning_details)

                    # Yield tool calls
                    if response.tool_calls:
                        for tc in response.tool_calls:
                            tool_calls.append(tc)
                            yield StreamEvent(type="tool_call", tool_call=tc)

                    # Yield metrics
                    if response.metrics:
                        yield StreamEvent(type="metrics", metrics=response.metrics)

            except Exception as e:
                self._record_last_messages(current_messages, inserted_system_prompt)
                yield self._llm_error_event(e)
                return

            # Handle tool calls
            if tool_calls:
                current_messages.append(Message(
                    role="assistant",
                    content=content_accumulated if content_accumulated else None,
                    tool_calls=tool_calls,
                    # Preserve reasoning_details for Gemini thought signatures
                    reasoning_details=reasoning_details_accumulated if reasoning_details_accumulated else None
                ))

                for tc in tool_calls:
                    func_name = tc["function"]["name"]
                    func_args_str = tc["function"]["arguments"]
                    call_id = tc["id"]

                    try:
                        func_args = json.loads(func_args_str)
                    except json.JSONDecodeError:
                        error_msg = f"Invalid JSON arguments: {func_args_str}"
                        current_messages.append(Message(
                            role="tool",
                            tool_call_id=call_id,
                            name=func_name,
                            content=json.dumps({"error": error_msg})
                        ))
                        yield StreamEvent(
                            type="tool_result",
                            tool_result={
                                "call_id": call_id,
                                "name": func_name,
                                "result": {"error": error_msg},
                                "is_error": True
                            }
                        )
                        continue

                    # Execute Tool
                    result, is_error, handled = await self.client.handle_tool_call(
                        func_name=func_name,
                        func_args=func_args,
                        session_id=self.session_id
                    )

                    # Handle extra tools if not a built-in Qveris tool
                    if not handled:
                        if self.extra_tool_handler:
                            try:
                                result = await self.extra_tool_handler(func_name, func_args)
                                is_error = False
                            except Exception as e:
                                result = {"error": str(e)}
                                is_error = True
                        else:
                            result = {"error": f"Unknown tool: {func_name}"}
                            is_error = True

                    # Yield tool_result event
                    yield StreamEvent(
                        type="tool_result",
                        tool_result={
                            "call_id": call_id,
                            "name": func_name,
                            "result": result,
                            "is_error": is_error
                        }
                    )

                    current_messages.append(Message(
                        role="tool",
                        tool_call_id=call_id,
                        name=func_name,
                        content=json.dumps(result, default=str)
                    ))

                self._record_last_messages(current_messages, inserted_system_prompt)
                continue

            else:
                if content_accumulated or reasoning_details_accumulated:
                    current_messages.append(Message(
                        role="assistant",
                        content=content_accumulated if content_accumulated else None,
                        reasoning_details=(
                            reasoning_details_accumulated if reasoning_details_accumulated else None
                        )
                    ))
                self._record_last_messages(current_messages, inserted_system_prompt)
                should_continue = False

        if should_continue:
            self._record_last_messages(current_messages, inserted_system_prompt)
            yield StreamEvent(
                type="error",
                error=f"Agent stopped after reaching max_iterations={self.config.max_iterations}"
            )

    async def run_to_completion(self, messages: List[Message]) -> str:
        """
        Run the agent in non-streaming mode and return the final assistant text.

        This is a convenience wrapper around `run(messages, stream=False)` that discards all events
        except `content` and returns the concatenated text.
        """
        content = ""
        async for event in self.run(messages, stream=False):
            if event.type == "content":
                content += event.content or ""
            elif event.type == "error":
                raise RuntimeError(f"Agent execution failed: {event.error}")
        return content

    def new_session(self) -> str:
        """
        Create and set a new session id.

        The session id is forwarded to Qveris API calls (discover/call) and can be used server-side
        for correlation, tracing, and analytics.
        """
        self.session_id = str(uuid.uuid4())
        return self.session_id
