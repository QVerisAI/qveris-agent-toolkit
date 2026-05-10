import json
import os
from typing import List, AsyncGenerator, Any, Dict, Optional
from openai import AsyncOpenAI
from openai.types.chat import ChatCompletionChunk, ChatCompletionToolParam
from ..base import LLMProvider
from .config import OpenAIConfig
from ...types import Message, StreamEvent, ChatResponse
from ...config import AgentConfig

class OpenAIProvider(LLMProvider):
    def __init__(self, config: Optional[OpenAIConfig] = None):
        self.config = config or OpenAIConfig()

        # AsyncOpenAI automatically picks up HTTP_PROXY/HTTPS_PROXY from env
        self.client = AsyncOpenAI(
            api_key=self.config.api_key,
            base_url=self.config.base_url
        )

    async def close(self) -> None:
        """Close the underlying async HTTP client."""
        await self.client.close()

    async def chat_stream(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig
    ) -> AsyncGenerator[StreamEvent, None]:

        # Convert Pydantic messages to OpenAI format
        openai_messages = []
        for msg in messages:
            m = {"role": msg.role, "content": msg.content}
            if msg.tool_calls:
                m["tool_calls"] = msg.tool_calls
            if msg.tool_call_id:
                m["tool_call_id"] = msg.tool_call_id
            if msg.name:
                m["name"] = msg.name

            # Pass through provider-specific reasoning_details if present
            if msg.reasoning_details:
                m["reasoning_details"] = msg.reasoning_details

            openai_messages.append(m)

        # Tools are already in OpenAI format (ChatCompletionToolParam)
        openai_tools = list(tools) if tools else None

        stream = await self.client.chat.completions.create(
            model=config.model,
            messages=openai_messages,
            tools=openai_tools,
            tool_choice="auto" if openai_tools else None,
            stream=True,
            stream_options={"include_usage": True},
            temperature=config.temperature
        )

        tool_calls_buffer = []

        async for chunk in stream:
            delta = chunk.choices[0].delta if chunk.choices else None

            # 1. Yield Content
            if delta and delta.content:
                yield StreamEvent(type="content", content=delta.content)

            # 2. Yield Reasoning (Standard OpenAI/DeepSeek)
            if hasattr(delta, 'reasoning') and delta.reasoning:
                 yield StreamEvent(type="reasoning", content=delta.reasoning)

            # 3. Yield Reasoning Details (OpenRouter/Gemini)
            # Check if reasoning_details exists on delta (it might be dynamic)
            if delta and hasattr(delta, 'reasoning_details') and delta.reasoning_details:
                details = delta.reasoning_details
                if not isinstance(details, list):
                    details = [details]

                # Yield as a specialized event
                yield StreamEvent(type="reasoning_details", details=details)

            # 4. Handle Tool Calls
            if delta and delta.tool_calls:
                for tc in delta.tool_calls:
                    if tc.index is not None:
                        if len(tool_calls_buffer) <= tc.index:
                            tool_calls_buffer.append({
                                "id": tc.id or "",
                                "type": "function",
                                "function": {
                                    "name": tc.function.name or "",
                                    "arguments": tc.function.arguments or ""
                                }
                            })
                        else:
                            if tc.function.arguments:
                                tool_calls_buffer[tc.index]["function"]["arguments"] += tc.function.arguments

            # 5. Yield Usage/Metrics
            if chunk.usage:
                yield StreamEvent(type="metrics", metrics={
                    "input_tokens": chunk.usage.prompt_tokens,
                    "output_tokens": chunk.usage.completion_tokens,
                    "total_tokens": chunk.usage.total_tokens
                })

        for tc in tool_calls_buffer:
            yield StreamEvent(type="tool_call", tool_call=tc)

    async def chat(
        self,
        messages: List[Message],
        tools: List[ChatCompletionToolParam],
        config: AgentConfig
    ) -> ChatResponse:
        """Non-streaming chat completion."""

        # Convert Pydantic messages to OpenAI format
        openai_messages = []
        for msg in messages:
            m = {"role": msg.role, "content": msg.content}
            if msg.tool_calls:
                m["tool_calls"] = msg.tool_calls
            if msg.tool_call_id:
                m["tool_call_id"] = msg.tool_call_id
            if msg.name:
                m["name"] = msg.name
            if msg.reasoning_details:
                m["reasoning_details"] = msg.reasoning_details
            openai_messages.append(m)

        openai_tools = list(tools) if tools else None

        response = await self.client.chat.completions.create(
            model=config.model,
            messages=openai_messages,
            tools=openai_tools,
            tool_choice="auto" if openai_tools else None,
            stream=False,
            temperature=config.temperature
        )

        if not response.choices:
            return ChatResponse()
        choice = response.choices[0]
        message = choice.message

        # Extract tool calls if present
        tool_calls = None
        if message.tool_calls:
            tool_calls = [
                {
                    "id": tc.id,
                    "type": "function",
                    "function": {
                        "name": tc.function.name,
                        "arguments": tc.function.arguments
                    }
                }
                for tc in message.tool_calls
            ]

        # Extract metrics
        metrics = None
        if response.usage:
            metrics = {
                "input_tokens": response.usage.prompt_tokens,
                "output_tokens": response.usage.completion_tokens,
                "total_tokens": response.usage.total_tokens
            }

        # Extract reasoning_details for Gemini thought signatures
        reasoning_details = None
        if hasattr(message, 'reasoning_details') and message.reasoning_details:
            reasoning_details = message.reasoning_details

        return ChatResponse(
            content=message.content,
            tool_calls=tool_calls,
            metrics=metrics,
            reasoning_details=reasoning_details
        )
