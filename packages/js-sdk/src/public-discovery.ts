import type { SearchResponse, ToolInfo } from './types.js';

/** Correlation only; never valid as Probe or Call authorization. */
export type PublicDiscoveryContext = `pub_${string}`;
export type PublicToolInfo = Pick<
  ToolInfo,
  | 'tool_id'
  | 'name'
  | 'tool_name'
  | 'description'
  | 'provider_id'
  | 'provider_name'
  | 'provider_description'
  | 'category'
  | 'region'
  | 'params'
  | 'parameters'
  | 'input_schema'
  | 'parameters_schema'
  | 'query_params'
  | 'body_params'
  | 'requestBody'
  | 'output_schema'
  | 'updated_at'
  | 'verification_status'
  | 'verification'
  | 'execution_restrictions'
  | 'capability'
  | 'reliability'
  | 'as_of_support'
>;
/** Public catalog projection: missing pricing and balance do not mean free. */
export type PublicSearchResponse = Omit<SearchResponse, 'search_id' | 'results' | 'remaining_credits'> & {
  search_id: PublicDiscoveryContext;
  results: PublicToolInfo[];
  contract_features: string[];
};

const PUBLIC_CONTEXT = /^pub_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPublicDiscoveryContext(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('pub_');
}

export function validatePublicBody(
  body: Record<string, unknown>,
  operation: 'discover' | 'inspect',
): Record<string, unknown> {
  const allowed = operation === 'discover' ? ['query', 'limit', 'view'] : ['tool_ids', 'search_id', 'view'];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new Error('Unsupported field in public read-only discovery');
  }
  if (body.view !== undefined && body.view !== 'full' && body.view !== 'routing') {
    throw new Error('Public discovery view must be full or routing');
  }
  if (operation === 'discover') {
    if (typeof body.query !== 'string' || body.query.trim().length < 1 || [...body.query.trim()].length > 1024) {
      throw new Error('Public discovery query must contain 1–1024 characters');
    }
    body = { ...body, query: body.query.trim() };
    if (
      body.limit !== undefined &&
      (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)
    ) {
      throw new Error('Public discovery limit must be an integer from 1 to 20');
    }
  } else {
    const ids = body.tool_ids;
    if (
      !Array.isArray(ids) ||
      ids.length < 1 ||
      ids.length > 10 ||
      new Set(ids).size !== ids.length ||
      ids.some(
        (id) =>
          typeof id !== 'string' ||
          !id.length ||
          [...id].length > 255 ||
          [...id].some((char) => (char.codePointAt(0) ?? 0) < 32 || char.codePointAt(0) === 127),
      )
    ) {
      throw new Error('Public Inspect requires 1–10 unique printable tool IDs of at most 255 characters');
    }
    if (body.search_id !== undefined && !PUBLIC_CONTEXT.test(String(body.search_id))) {
      throw new Error('Public Inspect requires a public discovery context');
    }
  }
  if (new TextEncoder().encode(JSON.stringify(body)).length > 8192) {
    throw new Error('Public discovery body exceeds 8192 bytes');
  }
  return body;
}

export function isPublicResponse(value: unknown): value is PublicSearchResponse {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.search_id === 'string' &&
    PUBLIC_CONTEXT.test(result.search_id) &&
    Array.isArray(result.results) &&
    Array.isArray(result.contract_features) &&
    result.contract_features.includes('public-readonly-v1') &&
    !Object.prototype.hasOwnProperty.call(result, 'remaining_credits')
  );
}
