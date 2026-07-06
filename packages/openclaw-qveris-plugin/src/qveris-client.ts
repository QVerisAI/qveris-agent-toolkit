// Pure HTTP client for the QVeris API. No SDK imports — only fetch + AbortController.

/** Encode Retry-After into the error message so classifyQverisError can parse it */
export function buildApiError(label: string, res: Response, detail: string): Error {
  const retryAfter = res.headers.get("Retry-After");
  const retryTag = retryAfter ? ` [retry-after:${retryAfter}]` : "";
  return new Error(
    `QVeris ${label} failed (${res.status}): ${detail || res.statusText}${retryTag}`,
  );
}

// ============================================================================
// Response Types
// ============================================================================

/** Parameter definition from QVeris discovery API */
export interface QverisDiscoverResultParam {
  name: string;
  type: string;
  required: boolean;
  description?: {
    en?: string;
    [key: string]: string | undefined;
  };
}

/** Example format from QVeris discovery API */
export interface QverisDiscoverResultExamples {
  sample_parameters?: Record<string, unknown>;
}

/** A single tool result from QVeris discovery */
export interface QverisDiscoverResultTool {
  tool_id: string;
  name: string;
  description: string;
  params?: QverisDiscoverResultParam[];
  provider_description?: string;
  stats?: {
    avg_execution_time_ms?: number;
    success_rate?: number;
  };
  examples?: QverisDiscoverResultExamples;
  /** Backend explanation of why this tool was recommended for the query */
  why_recommended?: string;
  /** Pre-call cost estimate in credits */
  expected_cost?: string | number;
}

/** QVeris /search response */
export interface QverisDiscoverResponse {
  query: string;
  total: number;
  results: QverisDiscoverResultTool[];
  /** Backend session ID — resolved internally, never exposed to the model */
  search_id: string;
  elapsed_time_ms?: number;
}

/** QVeris /tools/execute response */
export interface QverisCallResponse {
  execution_id: string;
  /** null when success is false */
  result: {
    data?: unknown;
    status_code?: unknown;
    message?: unknown;
    full_content_file_url?: unknown;
    truncated_content?: unknown;
    content_schema?: unknown;
  } | null;
  success: boolean;
  error_message: string | null;
  elapsed_time_ms: number;
  cost?: number;
  credits_used?: number;
}

/** QVeris /tools/by-ids response */
export interface QverisInspectResponse {
  tools: QverisDiscoverResultTool[];
}

// ============================================================================
// API Functions
// ============================================================================

export async function qverisDiscover(params: {
  query: string;
  sessionId: string;
  limit: number;
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: number;
}): Promise<QverisDiscoverResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);

  try {
    const res = await fetch(`${params.baseUrl}/search`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        query: params.query,
        limit: params.limit,
        session_id: params.sessionId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw buildApiError("discover", res, detail);
    }

    return (await res.json()) as QverisDiscoverResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function qverisCall(params: {
  toolId: string;
  searchId?: string;
  sessionId: string;
  parameters: Record<string, unknown>;
  maxResponseSize: number;
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: number;
}): Promise<QverisCallResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);

  try {
    const res = await fetch(
      `${params.baseUrl}/tools/execute?tool_id=${encodeURIComponent(params.toolId)}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${params.apiKey}`,
        },
        body: JSON.stringify({
          parameters: params.parameters,
          max_response_size: params.maxResponseSize,
          search_id: params.searchId ?? null,
          session_id: params.sessionId,
        }),
        signal: controller.signal,
      },
    );

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw buildApiError("call", res, detail);
    }

    return (await res.json()) as QverisCallResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function qverisInspect(params: {
  toolIds: string[];
  sessionId: string;
  apiKey: string;
  baseUrl: string;
  timeoutSeconds: number;
}): Promise<QverisInspectResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), params.timeoutSeconds * 1000);

  try {
    const res = await fetch(`${params.baseUrl}/tools/by-ids`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${params.apiKey}`,
      },
      body: JSON.stringify({
        tool_ids: params.toolIds,
        session_id: params.sessionId,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw buildApiError("inspect", res, detail);
    }

    return (await res.json()) as QverisInspectResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}
