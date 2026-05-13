from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


class QverisModel(BaseModel):
    """Base SDK model that tolerates additive API fields."""

    model_config = ConfigDict(extra="allow")


# --- Capability and billing types ---


class BillingPrice(QverisModel):
    amount_credits: float
    per: Optional[float] = None
    unit: Optional[str] = None
    unit_label: Optional[str] = None


class BillingChargeLine(QverisModel):
    component_key: str
    quantity: Optional[float] = None
    unit: Optional[str] = None
    unit_label: Optional[str] = None
    price: Optional[BillingPrice] = None
    amount_credits: Optional[float] = None
    description: Optional[str] = None
    is_adjustment: Optional[bool] = None


class BillingRule(QverisModel):
    metering_mode: Optional[str] = None
    billing_unit: Optional[str] = None
    billing_unit_label: Optional[str] = None
    price: Optional[BillingPrice] = None
    price_breakdown: Optional[List[Dict[str, Any]]] = None
    pricing_dimensions: Optional[List[Dict[str, Any]]] = None
    minimum_charge_credits: Optional[float] = None
    snapshot_id: Optional[int] = None
    snapshot_version: Optional[str] = None
    runtime_pricing_version: Optional[str] = None
    pricing_source_system: Optional[str] = None
    description: Optional[str] = None


class CompactBillingStatement(QverisModel):
    price: Optional[BillingPrice] = None
    quantity: Optional[float] = None
    charge_lines: Optional[List[BillingChargeLine]] = None
    minimum_charge_credits: Optional[float] = None
    list_amount_credits: Optional[float] = None
    requested_amount_credits: Optional[float] = None
    summary: Optional[str] = None


class ToolParameter(QverisModel):
    name: str
    type: Any
    required: bool = False
    description: Optional[Any] = None
    enum: Optional[List[Any]] = None


class ToolExamples(QverisModel):
    sample_parameters: Optional[Dict[str, Any]] = None


class ToolStats(QverisModel):
    avg_execution_time_ms: Optional[float] = None
    success_rate: Optional[float] = None
    cost: Optional[float] = None


class ToolInfo(QverisModel):
    tool_id: str
    name: Optional[str] = None
    description: Optional[Any] = None
    categories: Optional[List[str]] = None
    category: Optional[str] = None
    provider_name: Optional[str] = None
    provider_description: Optional[Any] = None
    provider_website_url: Optional[str] = None
    region: Optional[str] = None
    params: Optional[List[ToolParameter]] = None
    examples: Optional[ToolExamples] = None
    stats: Optional[ToolStats] = None
    billing_rule: Optional[BillingRule] = None
    final_score: Optional[float] = None
    score: Optional[float] = None
    has_last_execution: Optional[bool] = None
    last_execution_record: Optional[Dict[str, Any]] = None
    docs_url: Optional[str] = None
    protocol: Optional[str] = None


SearchToolResult = ToolInfo


class SearchStats(QverisModel):
    search_time_ms: Optional[float] = None
    vector_recall_count: Optional[int] = None
    fulltext_recall_count: Optional[int] = None


class SearchResponse(QverisModel):
    query: Optional[str] = None
    search_id: Optional[str] = None
    total: Optional[int] = None
    results: List[ToolInfo] = Field(default_factory=list)
    stats: Optional[SearchStats] = None
    remaining_credits: Optional[float] = None
    elapsed_time_ms: Optional[float] = None


class ExecuteResultTruncated(QverisModel):
    message: str
    full_content_file_url: str
    truncated_content: str
    content_schema: Optional[Dict[str, Any]] = None


class ToolExecutionResponse(QverisModel):
    execution_id: str
    success: bool
    result: Optional[Any] = None
    error_message: Optional[str] = None
    elapsed_time_ms: Optional[float] = None
    execution_time: Optional[float] = None
    tool_id: Optional[str] = None
    parameters: Optional[Dict[str, Any]] = None
    cost: Optional[float] = None
    billing: Optional[CompactBillingStatement] = None
    pre_settlement_bill: Optional[Dict[str, Any]] = None
    remaining_credits: Optional[float] = None
    created_at: Optional[str] = None


# --- Account audit types ---


ChargeOutcome = Literal[
    "charged",
    "included",
    "failed_not_charged",
    "failed_charged_review",
]


class UsageEventItem(QverisModel):
    id: str
    event_type: str
    source_system: str
    success: bool
    created_at: str
    kind: Optional[str] = None
    source_ref_type: Optional[str] = None
    source_ref_id: Optional[str] = None
    session_id: Optional[str] = None
    search_id: Optional[str] = None
    execution_id: Optional[str] = None
    tool_id: Optional[str] = None
    model: Optional[str] = None
    query: Optional[str] = None
    charge_outcome: Optional[str] = None
    error_message: Optional[str] = None
    billing_snapshot_status: Optional[str] = None
    pre_settlement_bill: Optional[Dict[str, Any]] = None
    settlement_result: Optional[Dict[str, Any]] = None
    requested_amount_credits: Optional[float] = None
    actual_amount_credits: Optional[float] = None
    credits_ledger_entry_id: Optional[str] = None
    display_target: Optional[str] = None
    billing_summary: Optional[str] = None
    pre_settlement_amount_credits: Optional[float] = None
    settled_amount_credits: Optional[float] = None


class UsageHistoryResponse(QverisModel):
    items: List[UsageEventItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 0
    summary: Optional[Dict[str, Any]] = None


class CreditsLedgerItem(QverisModel):
    id: str
    entry_type: str
    amount_credits: float
    source_system: str
    created_at: str
    source_ref_type: Optional[str] = None
    source_ref_id: Optional[str] = None
    pre_settlement_bill: Optional[Dict[str, Any]] = None
    settlement_result: Optional[Dict[str, Any]] = None
    balance_before: Optional[Dict[str, Any]] = None
    balance_after: Optional[Dict[str, Any]] = None
    ledger_metadata: Optional[Dict[str, Any]] = None
    description: Optional[str] = None


class CreditsLedgerResponse(QverisModel):
    items: List[CreditsLedgerItem] = Field(default_factory=list)
    total: int = 0
    page: int = 1
    page_size: int = 0
    summary: Optional[Dict[str, Any]] = None


class ApiErrorInfo(QverisModel):
    status: int
    message: str
    details: Optional[Any] = None


# --- Agent types ---


class Message(QverisModel):
    role: str
    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_call_id: Optional[str] = None
    name: Optional[str] = None
    # Support for provider-specific reasoning, for example Gemini via OpenRouter.
    reasoning_details: Optional[Any] = None


class StreamEvent(QverisModel):
    type: Literal["content", "reasoning", "tool_call", "tool_result", "metrics", "error", "reasoning_details"]
    content: Optional[str] = None
    tool_call: Optional[Dict[str, Any]] = None
    tool_result: Optional[Dict[str, Any]] = None
    metrics: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    details: Optional[Any] = None


class AgentMetrics(QverisModel):
    first_token_time: float = 0
    total_time: float = 0
    input_tokens: int = 0
    output_tokens: int = 0
    total_tokens: int = 0
    tool_call_count: int = 0


class ChatResponse(QverisModel):
    """Non-streaming response from LLM chat completion."""

    content: Optional[str] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    metrics: Optional[Dict[str, Any]] = None
    reasoning_details: Optional[Any] = None
