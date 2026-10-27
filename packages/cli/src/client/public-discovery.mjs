import { CliError } from "../errors/handler.mjs";

const PUBLIC_CONTEXT = /^pub_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isPublicDiscoveryContext(value) {
  return typeof value === "string" && value.startsWith("pub_");
}

export function validatePublicBody(body, operation) {
  const allowed = operation === "discover" ? ["query", "limit", "view"] : ["tool_ids", "search_id", "view"];
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new CliError("API_ERROR", "Unsupported field in public read-only discovery");
  }
  if (body.view !== undefined && !["full", "routing"].includes(body.view)) {
    throw new CliError("API_ERROR", "Public discovery view must be full or routing");
  }
  if (operation === "discover") {
    if (typeof body.query !== "string" || body.query.trim().length < 1 || [...body.query.trim()].length > 1024) {
      throw new CliError("API_ERROR", "Public discovery query must contain 1–1024 characters");
    }
    body = { ...body, query: body.query.trim() };
    if (body.limit !== undefined && (!Number.isInteger(body.limit) || body.limit < 1 || body.limit > 20)) {
      throw new CliError("API_ERROR", "Public discovery limit must be an integer from 1 to 20");
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
          typeof id !== "string" ||
          !id.length ||
          [...id].length > 255 ||
          [...id].some((char) => char.codePointAt(0) < 32 || char.codePointAt(0) === 127),
      )
    ) {
      throw new CliError(
        "API_ERROR",
        "Public Inspect requires 1–10 unique printable tool IDs of at most 255 characters",
      );
    }
    if (body.search_id !== undefined && !PUBLIC_CONTEXT.test(body.search_id)) {
      throw new CliError("API_ERROR", "Public Inspect requires a public discovery context");
    }
  }
  if (Buffer.byteLength(JSON.stringify(body), "utf8") > 8192) {
    throw new CliError("API_ERROR", "Public discovery body exceeds 8192 bytes");
  }
  return body;
}

export function validatePublicResponse(result) {
  if (
    !result ||
    !PUBLIC_CONTEXT.test(result.search_id) ||
    !Array.isArray(result.results) ||
    !result.contract_features?.includes("public-readonly-v1") ||
    Object.hasOwn(result, "remaining_credits")
  ) {
    throw new CliError("API_ERROR", "Endpoint did not return the public-readonly-v1 discovery contract");
  }
  return result;
}
