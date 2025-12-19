from typing import Any, Dict, List, Optional, Union, Literal
from pydantic import BaseModel, Field

# --- Tool Types ---

class SearchToolResult(BaseModel):
    tool_id: str
    description: str
    category: Optional[str] = None
    score: Optional[float] = None

class SearchResponse(BaseModel):
    query: Optional[str] = None
    total: Optional[int] = None
    results: List[SearchToolResult]
    search_id: Optional[str] = None
    elapsed_time_ms: Optional[float] = None

class ToolExecutionResponse(BaseModel):
    execution_id: str
    success: bool
    result: Any
    error_message: Optional[str] = None
    elapsed_time_ms: Optional[float] = None

# --- Agent Types ---

class Message(BaseModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    # Support for provider-specific reasoning (e.g., Gemini via OpenRouter)
    reasoning_details: Optional[Any] = None

class StreamEvent(BaseModel):
    type: Literal['content', 'reasoning', 'tool_call', 'tool_result', 'metrics', 'error', 'reasoning_details']
    content: Optional[str] = None
    tool_call: Optional[Dict[str, Any]] = None
    tool_result: Optional[Dict[str, Any]] = None  # For tool execution results
    metrics: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    details: Optional[Any] = None  # For reasoning_details

class AgentMetrics(BaseModel):
    first_token_time: float = 0
    total_time: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    tool_call_count: int = 0

class ChatResponse(BaseModel):
    """Non-streaming response from LLM chat completion."""
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[Dict[str, Any]] = None
    # Support for provider-specific reasoning (e.g., Gemini thought signatures via OpenRouter)
    reasoning_details: Optional[Any] = None
